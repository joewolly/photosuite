//! One reviewed local producer. No editor, document, history or filesystem authority.
use reqwest::blocking::{multipart, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{Cursor, Read},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

pub mod upscale;

pub const VERSION: &str = "0.37.4";
const SUPPORTED_VERSIONS: &[&str] = &["0.37.0", VERSION];
pub const WORKFLOW: &str = "photosuite-remove-v1";
const MAX_PIXELS: usize = 1024 * 1024;
const MAX_JSON: usize = 2 * 1024 * 1024;
const MAX_PNG: usize = 8 * 1024 * 1024;
const JOB_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub enabled: bool,
    pub endpoint: String,
    pub checkpoint: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Input {
    request_id: String,
    config: Config,
    width: u32,
    height: u32,
    seed: u32,
}
#[derive(Serialize)]
pub struct Capability {
    ready: bool,
    version: String,
    workflow: &'static str,
    model: String,
}
struct Active {
    id: String,
    cancel: AtomicBool,
    stage: Mutex<&'static str>,
}
impl Active {
    fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            Err("Local enhancement cancelled.".into())
        } else {
            Ok(())
        }
    }
    fn stage(&self, stage: &'static str) {
        *self.stage.lock().unwrap() = stage;
    }
}
#[derive(Default, Clone)]
pub struct ComfyState(Arc<Mutex<Option<Arc<Active>>>>);
struct Lease {
    state: ComfyState,
    active: Arc<Active>,
}
impl Drop for Lease {
    fn drop(&mut self) {
        let mut slot = self.state.0.lock().unwrap();
        if slot.as_ref().is_some_and(|a| Arc::ptr_eq(a, &self.active)) {
            *slot = None;
        }
    }
}
impl ComfyState {
    fn acquire(&self, id: &str) -> Result<Lease, String> {
        let mut slot = self.0.lock().unwrap();
        if slot.is_some() {
            return Err("Another local enhancement request is still running or stopping.".into());
        }
        let active = Arc::new(Active {
            id: id.into(),
            cancel: AtomicBool::new(false),
            stage: Mutex::new("Preparing"),
        });
        *slot = Some(active.clone());
        Ok(Lease {
            state: self.clone(),
            active,
        })
    }
}

// Exact textual authority avoids DNS, rebinding, URL parser shorthand/decimal IPs,
// credentials, encoded authorities, and misleading localhost suffixes.
fn endpoint(value: &str) -> Result<String, String> {
    let error = || {
        "Use http://127.0.0.1:PORT or http://[::1]:PORT, without a path, credentials, query or fragment.".to_string()
    };
    let authority = value
        .strip_prefix("http://")
        .ok_or_else(error)?
        .strip_suffix('/')
        .unwrap_or(value.strip_prefix("http://").unwrap());
    let port = authority
        .strip_prefix("127.0.0.1:")
        .or_else(|| authority.strip_prefix("[::1]:"))
        .ok_or_else(error)?;
    if port.is_empty()
        || !port.bytes().all(|b| b.is_ascii_digit())
        || port.parse::<u16>().unwrap_or(0) == 0
    {
        return Err(error());
    }
    Ok(format!("http://{authority}"))
}
fn validate_config(config: &Config) -> Result<String, String> {
    if !config.enabled {
        return Err("Enable AI Remove in Preferences and configure your local service.".into());
    }
    let url = endpoint(&config.endpoint)?;
    if config.checkpoint.is_empty()
        || config.checkpoint.len() > 240
        || config.checkpoint.chars().any(|c| c.is_control())
        || config.checkpoint.contains("..")
        || config.checkpoint.starts_with('/')
        || config.checkpoint.contains('\\')
    {
        return Err("Enter the exact compatible checkpoint identifier from your local ComfyUI installation.".into());
    }
    Ok(url)
}
fn validate_input(input: &Input, length: usize) -> Result<(), String> {
    validate_config(&input.config)?;
    if uuid::Uuid::parse_str(&input.request_id)
        .map(|u| u.to_string())
        .ok()
        .as_deref()
        != Some(&input.request_id)
    {
        return Err("Invalid AI Remove request identity.".into());
    }
    if !(512..=1024).contains(&input.width)
        || !(512..=1024).contains(&input.height)
        || input.width % 8 != 0
        || input.height % 8 != 0
        || (input.width as usize * input.height as usize) > MAX_PIXELS
        || length != input.width as usize * input.height as usize * 5
    {
        return Err("AI Remove input exceeds its 1024-pixel / 1-megapixel limit or has invalid dimensions/bytes.".into());
    }
    Ok(())
}
fn client() -> Result<Client, String> {
    Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Could not create local inference transport.".into())
}
fn network_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Local ComfyUI service timed out. Check the service and try again.".into()
    } else {
        "Could not reach the local ComfyUI service. Start ComfyUI and check Preferences.".into()
    }
}
fn bounded(response: Response, limit: usize) -> Result<Vec<u8>, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Local service returned HTTP {}. Check service logs, workflow and checkpoint setup.",
            status.as_u16()
        ));
    }
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Local service response exceeds the size limit.".into());
    }
    let mut out = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut out)
        .map_err(|_| "Local service response was interrupted.".to_string())?;
    if out.len() > limit {
        return Err("Local service response exceeds the size limit.".into());
    }
    Ok(out)
}
fn read_json(response: Result<Response, reqwest::Error>) -> Result<Value, String> {
    serde_json::from_slice(&bounded(response.map_err(network_error)?, MAX_JSON)?)
        .map_err(|_| "Local service returned malformed capability or job data.".into())
}
fn get(client: &Client, url: &str) -> Result<Value, String> {
    read_json(client.get(url).send())
}

// Literal graph; no workflow files, custom nodes, arbitrary expressions or model fallback.
fn workflow(input: &Input) -> Value {
    let id = &input.request_id;
    json!({
        "1":{"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":input.config.checkpoint}},
        "2":{"class_type":"LoadImage","inputs":{"image":format!("photosuite-{id}-source.png")}},
        "3":{"class_type":"LoadImageMask","inputs":{"image":format!("photosuite-{id}-mask.png"),"channel":"red"}},
        "4":{"class_type":"CLIPTextEncode","inputs":{"text":"clean background, natural texture, seamless","clip":["1",1]}},
        "5":{"class_type":"CLIPTextEncode","inputs":{"text":"object, text, watermark","clip":["1",1]}},
        "6":{"class_type":"InpaintModelConditioning","inputs":{"positive":["4",0],"negative":["5",0],"vae":["1",2],"pixels":["2",0],"mask":["3",0],"noise_mask":true}},
        "7":{"class_type":"KSampler","inputs":{"model":["1",0],"seed":input.seed,"steps":20,"cfg":7.0,"sampler_name":"euler","scheduler":"normal","positive":["6",0],"negative":["6",1],"latent_image":["6",2],"denoise":1.0}},
        "8":{"class_type":"VAEDecode","inputs":{"samples":["7",0],"vae":["1",2]}},
        "9":{"class_type":"SaveImage","inputs":{"images":["8",0],"filename_prefix":format!("photosuite-{id}")}}
    })
}
fn check_schema(info: &Value, graph: &Value, checkpoint: &str) -> Result<(), String> {
    let outputs = [
        ("CheckpointLoaderSimple", vec!["MODEL", "CLIP", "VAE"]),
        ("LoadImage", vec!["IMAGE", "MASK"]),
        ("LoadImageMask", vec!["MASK"]),
        ("CLIPTextEncode", vec!["CONDITIONING"]),
        (
            "InpaintModelConditioning",
            vec!["CONDITIONING", "CONDITIONING", "LATENT"],
        ),
        ("KSampler", vec!["LATENT"]),
        ("VAEDecode", vec!["IMAGE"]),
        ("SaveImage", vec!["IMAGE"]),
    ];
    check_graph_schema(info, graph, checkpoint, &outputs)
}
fn check_graph_schema(
    info: &Value,
    graph: &Value,
    checkpoint: &str,
    outputs: &[(&str, Vec<&str>)],
) -> Result<(), String> {
    for &(class, ref expected) in outputs {
        let node = &info[class];
        if node["output"] != json!(expected) {
            return Err(format!(
                "Required built-in node {class} is missing or incompatible."
            ));
        }
        if class == "SaveImage" && node["output_node"] != true {
            return Err("SaveImage output path is incompatible.".into());
        }
        let required = node["input"]["required"]
            .as_object()
            .ok_or_else(|| format!("Malformed input capabilities for {class}."))?;
        for configured in graph
            .as_object()
            .unwrap()
            .values()
            .filter(|n| n["class_type"] == class)
        {
            let inputs = configured["inputs"].as_object().unwrap();
            if required.keys().any(|key| !inputs.contains_key(key)) {
                return Err(format!("{class} requires unsupported workflow inputs."));
            }
            for (name, value) in inputs {
                let spec = required
                    .get(name)
                    .or_else(|| node["input"]["optional"].get(name))
                    .ok_or_else(|| format!("Required {class}.{name} capability is missing."))?;
                let kind = spec
                    .get(0)
                    .ok_or_else(|| format!("Malformed {class}.{name} capability."))?;
                if let Some(link) = value.as_array() {
                    let source = &graph[link[0].as_str().unwrap()];
                    let source_type = source["class_type"].as_str().unwrap();
                    let expected = &info[source_type]["output"][link[1].as_u64().unwrap() as usize];
                    if kind != expected {
                        return Err(format!(
                            "Incompatible workflow connection at {class}.{name}."
                        ));
                    }
                } else if let Some(choices) = kind.as_array().or_else(|| {
                    if kind == "COMBO" {
                        spec[1]["options"].as_array()
                    } else {
                        None
                    }
                }) {
                    // Upload inputs enumerate existing files; newly owned files do not exist at preflight.
                    if name != "image" && !choices.contains(value) {
                        return Err(if name == "ckpt_name" || name == "model_name" {
                            format!("Configured model '{checkpoint}' is not available. Install it yourself in ComfyUI or correct its identifier.")
                        } else {
                            format!("Unsupported {class}.{name} workflow setting.")
                        });
                    }
                    if name == "image" && spec[1]["image_upload"] != true {
                        return Err(format!(
                            "{class} does not support the required image upload input."
                        ));
                    }
                } else {
                    let valid = match kind.as_str() {
                        Some("STRING") => value.is_string(),
                        Some("BOOLEAN") => value.is_boolean(),
                        Some("INT") => value.is_u64(),
                        Some("FLOAT") => value.is_number(),
                        _ => false,
                    };
                    if !valid {
                        return Err(format!(
                            "Malformed or incompatible {class}.{name} capability."
                        ));
                    }
                    if let Some(n) = value.as_f64() {
                        if spec[1]["min"].as_f64().is_some_and(|min| n < min)
                            || spec[1]["max"].as_f64().is_some_and(|max| n > max)
                        {
                            return Err(format!(
                                "Configured {class}.{name} is outside server limits."
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
// JSON has one numeric type. A service may serialize 7.0 as 7; the value and
// every graph key/link must still match. All workflow integers fit exactly in f64.
fn same_workflow(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same_workflow(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| same_workflow(a, b)))
        }
        _ => a == b,
    }
}
fn preflight(
    client: &Client,
    config: &Config,
    active: Option<&Active>,
) -> Result<Capability, String> {
    let base = validate_config(config)?;
    let stats = get(client, &format!("{base}/system_stats"))?;
    let version = stats["system"]["comfyui_version"].as_str().unwrap_or("");
    if !SUPPORTED_VERSIONS.contains(&version) {
        return Err("AI Remove supports ComfyUI 0.37.0 or 0.37.4; this service reports a different or missing version.".into());
    }
    let mut info = serde_json::Map::new();
    for class in [
        "CheckpointLoaderSimple",
        "LoadImage",
        "LoadImageMask",
        "CLIPTextEncode",
        "InpaintModelConditioning",
        "KSampler",
        "VAEDecode",
        "SaveImage",
    ] {
        if let Some(active) = active {
            active.check()?;
        }
        let value = get(client, &format!("{base}/object_info/{class}"))?;
        info.insert(class.into(), value[class].clone());
    }
    let input = Input {
        request_id: uuid::Uuid::nil().to_string(),
        config: config.clone(),
        width: 512,
        height: 512,
        seed: 0,
    };
    check_schema(&Value::Object(info), &workflow(&input), &config.checkpoint)?;
    Ok(Capability {
        ready: true,
        version: version.into(),
        workflow: WORKFLOW,
        model: config.checkpoint.clone(),
    })
}
fn png_rgb(width: u32, height: u32, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        encoder
            .write_header()
            .map_err(|_| "Could not encode inpaint input.")?
            .write_image_data(bytes)
            .map_err(|_| "Could not encode inpaint input.")?;
    }
    if out.len() > MAX_PNG {
        return Err("Encoded inpaint input exceeds the upload limit.".into());
    }
    Ok(out)
}
fn encode_inputs(input: &Input, bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let pixels = input.width as usize * input.height as usize;
    let mut rgb = vec![0; pixels * 3];
    let mut mask = vec![0; pixels * 3];
    for i in 0..pixels {
        let alpha = bytes[i * 4 + 3] as u32;
        for c in 0..3 {
            rgb[i * 3 + c] =
                ((bytes[i * 4 + c] as u32 * alpha + 255 * (255 - alpha) + 127) / 255) as u8;
            mask[i * 3 + c] = if bytes[pixels * 4 + i] == 0 { 0 } else { 255 };
        }
    }
    Ok((
        png_rgb(input.width, input.height, &rgb)?,
        png_rgb(input.width, input.height, &mask)?,
    ))
}
#[cfg(test)]
fn decode_output(bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    decode_output_bounded(bytes, width, height, MAX_PNG)
}
fn decode_output_bounded(
    bytes: &[u8],
    width: u32,
    height: u32,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if bytes.len() > limit {
        return Err("Result PNG exceeds the size limit.".into());
    }
    let decoder = png::Decoder::new_with_limits(Cursor::new(bytes), png::Limits { bytes: limit });
    let mut reader = decoder
        .read_info()
        .map_err(|_| "Local enhancement returned a malformed PNG image.")?;
    let info = reader.info();
    if info.width != width
        || info.height != height
        || info.bit_depth != png::BitDepth::Eight
        || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba)
        || info.animation_control.is_some()
    {
        return Err("Local enhancement returned unsupported image dimensions or format.".into());
    }
    let mut decoded = vec![0; reader.output_buffer_size()];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|_| "Local enhancement returned an incomplete PNG image.")?;
    let channels = if frame.color_type == png::ColorType::Rgb {
        3
    } else {
        4
    };
    let mut rgba = vec![255; width as usize * height as usize * 4];
    for (source, target) in decoded.chunks_exact(channels).zip(rgba.chunks_exact_mut(4)) {
        target[..3].copy_from_slice(&source[..3]);
    }
    Ok(rgba)
}
fn upload(client: &Client, base: &str, name: &str, png: Vec<u8>) -> Result<(), String> {
    let part = multipart::Part::bytes(png)
        .file_name(name.to_owned())
        .mime_str("image/png")
        .unwrap();
    let response = read_json(
        client
            .post(format!("{base}/upload/image"))
            .multipart(
                multipart::Form::new()
                    .part("image", part)
                    .text("type", "input")
                    .text("overwrite", "false"),
            )
            .send(),
    )?;
    if response["name"] != name || response["type"] != "input" || response["subfolder"] != "" {
        return Err("The local service returned an unexpected upload identity.".into());
    }
    Ok(())
}
fn cancel_owned(client: &Client, base: &str, id: &str) {
    // Best effort ONLY this request. Acknowledgement is not proof that GPU execution ended.
    let _ = read_json(
        client
            .post(format!("{base}/api/jobs/{id}/cancel"))
            .json(&json!({}))
            .send(),
    );
}
fn run(input: &Input, bytes: &[u8], active: &Active) -> Result<Vec<u8>, String> {
    validate_input(input, bytes.len())?;
    let client = client()?;
    let base = validate_config(&input.config)?;
    active.check()?;
    preflight(&client, &input.config, Some(active))?;
    active.check()?;
    let (source, mask) = encode_inputs(input, bytes)?;
    active.stage("Uploading");
    upload(
        &client,
        &base,
        &format!("photosuite-{}-source.png", input.request_id),
        source,
    )?;
    active.check()?;
    upload(
        &client,
        &base,
        &format!("photosuite-{}-mask.png", input.request_id),
        mask,
    )?;
    active.check()?;
    execute_graph(
        &client,
        &base,
        &input.request_id,
        workflow(input),
        WORKFLOW,
        input.width,
        input.height,
        MAX_PNG,
        active,
    )
}
// Shared M2 transport: owned submission, targeted cancellation, bounded polling and decoding.
#[allow(clippy::too_many_arguments)]
fn execute_graph(
    client: &Client,
    base: &str,
    request_id: &str,
    graph: Value,
    workflow_id: &str,
    width: u32,
    height: u32,
    max_png: usize,
    active: &Active,
) -> Result<Vec<u8>, String> {
    // Once submission is attempted, even a lost acknowledgement may have queued it.
    // Never retry submission. Cancel the known, unique owned ID on every error path.
    let outcome = (|| {
        let submitted = read_json(client.post(format!("{base}/prompt")).json(&json!({
            "prompt_id":request_id,"client_id":format!("photosuite-{}",request_id),
            "extra_data":{"photosuite_request_id":request_id,"photosuite_workflow":workflow_id},
            "prompt":graph
        })).send())?;
        if submitted["prompt_id"] != request_id
            || !submitted["number"].is_number()
            || submitted["node_errors"]
                .as_object()
                .map_or(true, |v| !v.is_empty())
        {
            return Err(
                "Local service rejected the workflow or returned the wrong job identity.".into(),
            );
        }
        let started = Instant::now();
        loop {
            active.check()?;
            if started.elapsed() > JOB_TIMEOUT {
                return Err(
                    "Local enhancement exceeded its 15 minute queue/generation limit.".into(),
                );
            }
            let job = get(&client, &format!("{base}/api/jobs/{}", request_id))?;
            if job["id"] != request_id {
                return Err("Local service returned the wrong job identity.".into());
            }
            match job["status"].as_str() {
                Some("pending") => active.stage("Queued"),
                Some("in_progress") => active.stage("Generating"),
                Some("failed") => {
                    return Err(
                        "Local enhancement failed. Check the configured model and service logs."
                            .into(),
                    )
                }
                Some("cancelled") => return Err("The local enhancement job was cancelled.".into()),
                Some("completed") => {
                    active.check()?;
                    if job["workflow"]["extra_data"]["photosuite_request_id"] != request_id
                        || job["workflow"]["extra_data"]["photosuite_workflow"] != workflow_id
                        || !same_workflow(&job["workflow"]["prompt"], &graph)
                    {
                        return Err("The completed workflow does not belong to this Local enhancement request.".into());
                    }
                    let images = job["outputs"]["9"]["images"]
                        .as_array()
                        .ok_or("Local enhancement completed without its output image.")?;
                    if images.len() != 1 {
                        return Err(
                            "Local enhancement returned an unexpected number of images.".into()
                        );
                    }
                    let image = &images[0];
                    let filename = image["filename"]
                        .as_str()
                        .ok_or("Missing result filename.")?;
                    let prefix = format!("photosuite-{}_", request_id);
                    if !filename.starts_with(&prefix)
                        || !filename.ends_with(".png")
                        || filename.contains(['/', '\\'])
                        || image["subfolder"] != ""
                        || image["type"] != "output"
                    {
                        return Err("Local service returned an unowned result path.".into());
                    }
                    active.stage("Receiving result");
                    let response = client
                        .get(format!("{base}/view"))
                        .query(&[
                            ("filename", filename),
                            ("type", "output"),
                            ("subfolder", ""),
                        ])
                        .send()
                        .map_err(network_error)?;
                    if response
                        .headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .map(|v| v.split(';').next())
                        != Some(Some("image/png"))
                    {
                        return Err(
                            "Local enhancement returned an unexpected output content type.".into(),
                        );
                    }
                    let data = bounded(response, max_png)?;
                    active.check()?;
                    let output = decode_output_bounded(&data, width, height, max_png)?;
                    active.check()?;
                    return Ok(output);
                }
                _ => return Err("Local service returned malformed job status.".into()),
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    })();
    if outcome.is_err() {
        cancel_owned(&client, &base, &request_id);
    }
    outcome
}

#[tauri::command]
pub async fn comfy_preflight(config: Config) -> Result<Capability, String> {
    validate_config(&config)?;
    tauri::async_runtime::spawn_blocking(move || preflight(&client()?, &config, None))
        .await
        .map_err(|_| "Preflight worker failed.".to_string())?
}
#[tauri::command]
pub async fn comfy_inpaint(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, ComfyState>,
) -> Result<tauri::ipc::Response, String> {
    let header = request
        .headers()
        .get("x-photosuite-inpaint")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing AI Remove metadata.")?;
    if header.len() > 4096 {
        return Err("AI Remove metadata is too large.".into());
    }
    let input: Input = serde_json::from_str(&crate::percent_decode(header)?)
        .map_err(|_| "Malformed AI Remove metadata.")?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        _ => return Err("AI Remove expects a binary input body.".into()),
    };
    validate_input(&input, data.len())?;
    let lease = state.acquire(&input.request_id)?;
    let owned = data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let output = run(&input, &owned, &lease.active);
        drop(lease);
        output.map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "Local inference worker failed.".to_string())?
}
#[tauri::command]
pub fn comfy_status(request_id: String, state: tauri::State<'_, ComfyState>) -> Value {
    let slot = state.0.lock().unwrap();
    match slot.as_ref().filter(|active| active.id == request_id) {
        Some(active) => json!({"stage":*active.stage.lock().unwrap()}),
        None => json!({"stage":"Preparing"}),
    }
}
#[tauri::command]
pub fn comfy_cancel(request_id: String, state: tauri::State<'_, ComfyState>) {
    if let Some(active) = state
        .0
        .lock()
        .unwrap()
        .as_ref()
        .filter(|a| a.id == request_id)
    {
        active.cancel.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests;
