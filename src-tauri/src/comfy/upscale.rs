//! M5b: one stock-node RGB super-resolution workflow, using M2's transport lease.
use super::*;
pub const WORKFLOW: &str = "photosuite-upscale-v1";
pub const MODEL: &str = "realesr-general-x4v3.pth";
const MAX_SOURCE_PIXELS: u64 = 524_288;
const MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;
const MAX_OUTPUT_PNG: usize = MAX_OUTPUT_BYTES + 1024 * 1024;
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpscaleConfig {
    pub endpoint: String,
    pub model: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpscaleInput {
    request_id: String,
    config: UpscaleConfig,
    width: u32,
    height: u32,
    scale: u32,
}
fn config_base(config: &UpscaleConfig) -> Result<String, String> {
    let base = endpoint(&config.endpoint)?;
    if config.model != MODEL {
        return Err(format!(
            "AI Upscale requires the reviewed {MODEL} model. No substitute is supported."
        ));
    }
    Ok(base)
}
fn geometry(width: u32, height: u32, scale: u32) -> Result<(u32, u32), String> {
    let pixels = u64::from(width) * u64::from(height);
    if scale != 4
        || width == 0
        || height == 0
        || width > 1024
        || height > 1024
        || pixels > MAX_SOURCE_PIXELS
    {
        return Err("AI Upscale supports 4x only, sources up to 1024 pixels per side and 524288 pixels; output at most 4096 per side / 8388608 pixels / 32 MiB RGBA.".into());
    }
    Ok((width * scale, height * scale))
}
fn validate(input: &UpscaleInput, length: usize) -> Result<(u32, u32), String> {
    config_base(&input.config)?;
    let dims = geometry(input.width, input.height, input.scale)?;
    if uuid::Uuid::parse_str(&input.request_id)
        .map(|id| id.to_string())
        .ok()
        .as_deref()
        != Some(&input.request_id)
        || length != input.width as usize * input.height as usize * 4
    {
        return Err("Invalid AI Upscale identity or pixel bytes.".into());
    }
    Ok(dims)
}
fn graph(input: &UpscaleInput) -> Value {
    json!({
        "1":{"class_type":"UpscaleModelLoader","inputs":{"model_name":input.config.model}},
        "2":{"class_type":"LoadImage","inputs":{"image":format!("photosuite-{}-source.png",input.request_id)}},
        "3":{"class_type":"ImageUpscaleWithModel","inputs":{"upscale_model":["1",0],"image":["2",0]}},
        "9":{"class_type":"SaveImage","inputs":{"images":["3",0],"filename_prefix":format!("photosuite-{}",input.request_id)}}
    })
}
fn preflight_upscale(
    client: &Client,
    config: &UpscaleConfig,
    active: Option<&Active>,
) -> Result<Capability, String> {
    let base = config_base(config)?;
    let stats = get(client, &format!("{base}/system_stats"))?;
    let version = stats["system"]["comfyui_version"].as_str().unwrap_or("");
    // This node schema/tiler was reviewed specifically at 0.37.4.
    if version != VERSION {
        return Err("AI Upscale requires reviewed ComfyUI 0.37.4.".into());
    }
    let outputs = [
        ("UpscaleModelLoader", vec!["UPSCALE_MODEL"]),
        ("LoadImage", vec!["IMAGE", "MASK"]),
        ("ImageUpscaleWithModel", vec!["IMAGE"]),
        ("SaveImage", vec!["IMAGE"]),
    ];
    let mut info = serde_json::Map::new();
    for (class, _) in &outputs {
        if let Some(active) = active {
            active.check()?;
        }
        let value = get(client, &format!("{base}/object_info/{class}"))?;
        info.insert((*class).into(), value[class].clone());
    }
    let input = UpscaleInput {
        request_id: uuid::Uuid::nil().to_string(),
        config: config.clone(),
        width: 1,
        height: 1,
        scale: 4,
    };
    check_graph_schema(
        &Value::Object(info),
        &graph(&input),
        &config.model,
        &outputs,
    )?;
    Ok(Capability {
        ready: true,
        version: version.into(),
        workflow: WORKFLOW,
        model: config.model.clone(),
    })
}
fn run_upscale(input: &UpscaleInput, bytes: &[u8], active: &Active) -> Result<Vec<u8>, String> {
    let (width, height) = validate(input, bytes.len())?;
    let client = client()?;
    let base = config_base(&input.config)?;
    active.check()?;
    preflight_upscale(&client, &input.config, Some(active))?;
    active.check()?;
    // JS supplies RGB with transparent colors extended from covered pixels. Alpha stays editor-side.
    let rgb: Vec<u8> = bytes
        .chunks_exact(4)
        .flat_map(|pixel| pixel[..3].iter().copied())
        .collect();
    let png = png_rgb(input.width, input.height, &rgb)?;
    active.stage("Uploading");
    upload(
        &client,
        &base,
        &format!("photosuite-{}-source.png", input.request_id),
        png,
    )?;
    active.check()?;
    execute_graph(
        &client,
        &base,
        &input.request_id,
        graph(input),
        WORKFLOW,
        width,
        height,
        MAX_OUTPUT_PNG,
        active,
    )
}
#[tauri::command]
pub async fn comfy_upscale_preflight(config: UpscaleConfig) -> Result<Capability, String> {
    config_base(&config)?;
    tauri::async_runtime::spawn_blocking(move || preflight_upscale(&client()?, &config, None))
        .await
        .map_err(|_| "Upscale preflight worker failed.".to_string())?
}
#[tauri::command]
pub async fn comfy_upscale(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, ComfyState>,
) -> Result<tauri::ipc::Response, String> {
    let header = request
        .headers()
        .get("x-photosuite-upscale")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing AI Upscale metadata.")?;
    if header.len() > 4096 {
        return Err("AI Upscale metadata is too large.".into());
    }
    let input: UpscaleInput = serde_json::from_str(&crate::percent_decode(header)?)
        .map_err(|_| "Malformed AI Upscale metadata.")?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        _ => return Err("AI Upscale expects binary pixels.".into()),
    };
    validate(&input, data.len())?;
    let lease = state.acquire(&input.request_id)?;
    let owned = data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let output = run_upscale(&input, &owned, &lease.active);
        drop(lease);
        output.map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "Upscale worker failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checked_geometry_and_model() {
        assert_eq!(geometry(3, 5, 4).unwrap(), (12, 20));
        assert_eq!(geometry(1024, 512, 4).unwrap(), (4096, 2048));
        for (w, h, s) in [
            (0, 1, 4),
            (1025, 1, 4),
            (1024, 513, 4),
            (u32::MAX, u32::MAX, 4),
            (3, 5, 2),
        ] {
            assert!(geometry(w, h, s).is_err());
        }
        assert!(config_base(&UpscaleConfig {
            endpoint: "http://127.0.0.1:8188".into(),
            model: "other4x.pth".into()
        })
        .is_err());
    }
    fn capabilities() -> Value {
        json!({
            "LoadImage":{"output":["IMAGE","MASK"],"input":{"required":{"image":[[],{"image_upload":true}]}}},
            "UpscaleModelLoader":{"output":["UPSCALE_MODEL"],"input":{"required":{"model_name":["COMBO",{"options":[MODEL]}]}}},
            "ImageUpscaleWithModel":{"output":["IMAGE"],"input":{"required":{"upscale_model":["UPSCALE_MODEL"],"image":["IMAGE"]}}},
            "SaveImage":{"output":["IMAGE"],"output_node":true,"input":{"required":{"images":["IMAGE"],"filename_prefix":["STRING"]}}}
        })
    }
    #[test]
    fn upscale_fake_service_matrix() {
        use crate::comfy::tests::{preflight_reply, Reply, Server};
        for scenario in [
            "valid",
            "missing-model",
            "missing-node",
            "wrong-version",
            "wrong-job",
            "changed-graph",
            "restart",
            "wrong-dimensions",
            "malformed",
            "oversize",
            "format",
            "cancel-queued",
            "cancel-running",
            "cancel-download",
        ] {
            let active = Arc::new(Active {
                id: uuid::Uuid::new_v4().to_string(),
                cancel: AtomicBool::new(false),
                stage: Mutex::new("Preparing"),
            });
            let trigger = active.clone();
            let mut submitted = Value::Null;
            let server = Server::new(move |r| {
                assert!(!["/interrupt", "/queue", "/api/jobs/cancel"].contains(&r.path.as_str()));
                let mut info = capabilities();
                if scenario == "missing-model" {
                    info["UpscaleModelLoader"]["input"]["required"]["model_name"][1]["options"] =
                        json!([]);
                }
                if scenario == "missing-node" {
                    info["ImageUpscaleWithModel"] = Value::Null;
                }
                if let Some(reply) = preflight_reply(
                    &r.path,
                    &info,
                    if scenario == "wrong-version" {
                        "0.37.0"
                    } else {
                        VERSION
                    },
                ) {
                    return reply;
                }
                if r.path == "/upload/image" {
                    let text = String::from_utf8_lossy(&r.body);
                    let filename = text
                        .split("filename=\"")
                        .nth(1)
                        .unwrap()
                        .split('"')
                        .next()
                        .unwrap();
                    return Reply::json(json!({"name":filename,"type":"input","subfolder":""}));
                }
                if r.path == "/prompt" {
                    submitted = serde_json::from_slice(&r.body).unwrap();
                    assert_eq!(submitted["prompt"].as_object().unwrap().len(), 4);
                    return Reply::json(
                        json!({"prompt_id":submitted["prompt_id"],"number":1,"node_errors":{}}),
                    );
                }
                if r.path.ends_with("/cancel") {
                    assert_eq!(r.path, format!("/api/jobs/{}/cancel", trigger.id));
                    return Reply::json(json!({}));
                }
                if r.path.starts_with("/api/jobs/") {
                    let id = submitted["prompt_id"].as_str().unwrap();
                    let mut job = json!({"id":id,"status":"completed","workflow":{"prompt":submitted["prompt"],"extra_data":submitted["extra_data"]},"outputs":{"9":{"images":[{"filename":format!("photosuite-{id}_00001_.png"),"subfolder":"","type":"output"}]}}});
                    if scenario == "wrong-job" {
                        job["id"] = json!("foreign");
                    }
                    if scenario == "changed-graph" {
                        job["workflow"]["prompt"]["1"]["inputs"]["model_name"] =
                            json!("other4x.pth");
                    }
                    if scenario.starts_with("cancel-") && scenario != "cancel-download" {
                        job["status"] = json!(if scenario == "cancel-queued" {
                            "pending"
                        } else {
                            "in_progress"
                        });
                        trigger.cancel.store(true, Ordering::SeqCst);
                    }
                    let mut reply = Reply::json(job);
                    if scenario == "restart" {
                        reply.status = 404;
                    }
                    return reply;
                }
                assert!(r.path.starts_with("/view?"));
                if scenario == "cancel-download" {
                    trigger.cancel.store(true, Ordering::SeqCst);
                }
                let w = if scenario == "wrong-dimensions" {
                    16
                } else {
                    12
                };
                Reply {
                    status: 200,
                    body: if scenario == "malformed" {
                        b"broken".to_vec()
                    } else {
                        png_rgb(w, 20, &vec![99; w as usize * 20 * 3]).unwrap()
                    },
                    kind: if scenario == "format" {
                        "image/jpeg"
                    } else {
                        "image/png"
                    },
                    extra: if scenario == "oversize" {
                        format!("Content-Length: {}\r\n", MAX_OUTPUT_PNG + 1)
                    } else {
                        String::new()
                    },
                }
            });
            let input = UpscaleInput {
                request_id: active.id.clone(),
                config: UpscaleConfig {
                    endpoint: server.endpoint.clone(),
                    model: MODEL.into(),
                },
                width: 3,
                height: 5,
                scale: 4,
            };
            let result = run_upscale(&input, &[90, 100, 110, 255].repeat(15), &active);
            assert_eq!(
                result.is_ok(),
                scenario == "valid",
                "{scenario}: {:?}",
                result.as_ref().err()
            );
            if let Ok(bytes) = result {
                assert_eq!(bytes.len(), 12 * 20 * 4);
                assert_eq!(&bytes[..4], &[99, 99, 99, 255]);
            }
        }
    }
    // Opt-in evidence only; no live service, weights or fixture filesystem required in CI.
    #[test]
    #[ignore]
    fn real_upscale_corpus() {
        let dir = std::env::var("PHOTOSUITE_UPSCALE_CORPUS")
            .expect("Set external evidence corpus directory");
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(format!("{dir}/manifest.json")).unwrap())
                .unwrap();
        let mut receipts = Vec::new();
        for item in manifest["cases"].as_array().unwrap() {
            let name = item["id"].as_str().unwrap();
            let input = UpscaleInput {
                request_id: uuid::Uuid::new_v4().to_string(),
                config: UpscaleConfig {
                    endpoint: "http://127.0.0.1:8188".into(),
                    model: MODEL.into(),
                },
                width: item["width"].as_u64().unwrap() as u32,
                height: item["height"].as_u64().unwrap() as u32,
                scale: 4,
            };
            let bytes = std::fs::read(format!("{dir}/{name}-model.bin")).unwrap();
            let active = Active {
                id: input.request_id.clone(),
                cancel: AtomicBool::new(false),
                stage: Mutex::new("Preparing"),
            };
            let start = Instant::now();
            let output = run_upscale(&input, &bytes, &active).unwrap();
            let ms = start.elapsed().as_millis();
            assert_eq!(
                output.len(),
                input.width as usize * input.height as usize * 64
            );
            std::fs::write(format!("{dir}/{name}-output.bin"), &output).unwrap();
            receipts.push(json!({"id":name,"requestId":input.request_id,"width":input.width*4,"height":input.height*4,"bytes":output.len(),"transportMs":ms}));
            println!("{name}: {}x{} / {ms}ms", input.width * 4, input.height * 4);
            std::fs::write(
                format!("{dir}/real-receipts.json"),
                serde_json::to_vec_pretty(&receipts).unwrap(),
            )
            .unwrap();
        }
    }
}
