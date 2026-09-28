//! Fixed M6 masked generation; M2 retains all networking and cancellation ownership.
use super::*;
pub const WORKFLOW: &str = "photosuite-generative-fill-v1";
pub const MODEL: &str = "sd-v1-5-inpainting.ckpt";
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GenerativeInput {
    input: Input,
    prompt: String,
}
pub(super) fn validate_prompt(prompt: &str) -> Result<(), String> {
    if prompt.len() > 2048
        || prompt.encode_utf16().count() > 1024
        || prompt
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err(
            "Prompt must be valid text, at most 1024 characters and 2048 UTF-8 bytes.".into(),
        );
    }
    Ok(())
}
pub(super) fn validate_model(config: &Config) -> Result<(), String> {
    if config.checkpoint != MODEL {
        return Err(format!(
            "Generative Fill requires the reviewed {MODEL} checkpoint."
        ));
    }
    Ok(())
}
#[tauri::command]
pub async fn comfy_generative_preflight(config: Config) -> Result<Capability, String> {
    validate_config(&config)?;
    validate_model(&config)?;
    tauri::async_runtime::spawn_blocking(move || {
        preflight_masked(&client()?, &config, None, Some(""))
    })
    .await
    .map_err(|_| "Generative preflight worker failed.".to_string())?
}
#[tauri::command]
pub async fn comfy_generative(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, ComfyState>,
) -> Result<tauri::ipc::Response, String> {
    let header = request
        .headers()
        .get("x-photosuite-inpaint")
        .and_then(|v| v.to_str().ok())
        .ok_or("Missing Generative Fill metadata.")?;
    if header.len() > 12288 {
        return Err("Generative Fill metadata is too large.".into());
    }
    let value: GenerativeInput = serde_json::from_str(&crate::percent_decode(header)?)
        .map_err(|_| "Malformed Generative Fill metadata.")?;
    validate_prompt(&value.prompt)?;
    validate_model(&value.input.config)?;
    let data = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data,
        _ => return Err("Generative Fill expects binary pixels and mask.".into()),
    };
    validate_input(&value.input, data.len())?;
    let lease = state.acquire(&value.input.request_id)?;
    let owned = data.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let output = run_masked(&value.input, &owned, &lease.active, Some(&value.prompt));
        drop(lease);
        output.map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|_| "Generative Fill worker failed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> Input {
        Input {
            request_id: uuid::Uuid::new_v4().to_string(),
            config: Config {
                enabled: true,
                endpoint: "http://127.0.0.1:8188".into(),
                checkpoint: MODEL.into(),
            },
            width: 512,
            height: 512,
            seed: 42,
        }
    }
    #[test]
    fn prompt_and_fixed_workflow() {
        for prompt in [
            "",
            "猫 🐈",
            "  red jacket\n",
            &"a".repeat(1024),
            &"é".repeat(1024),
        ] {
            assert!(validate_prompt(prompt).is_ok());
        }
        for prompt in ["\0", &"a".repeat(1025), &"猫".repeat(700)] {
            assert!(validate_prompt(prompt).is_err());
        }
        for prompt in [serde_json::json!(null), json!(3), json!({})] {
            assert!(serde_json::from_value::<GenerativeInput>(json!({"input":{"requestId":uuid::Uuid::nil().to_string(),"config":{"enabled":true,"endpoint":"http://127.0.0.1:8188","checkpoint":MODEL},"width":512,"height":512,"seed":42},"prompt":prompt})).is_err());
        }
        let i = input();
        let old = workflow(&i);
        let generated = masked_workflow(&i, Some("猫, wooden cup"));
        assert_eq!(generated["4"]["inputs"]["text"], "猫, wooden cup");
        assert_eq!(generated["5"]["inputs"]["text"], "");
        assert_eq!(
            old["4"]["inputs"]["text"],
            "clean background, natural texture, seamless"
        );
        assert_eq!(old["5"]["inputs"]["text"], "object, text, watermark");
        for node in ["1", "2", "3", "6", "7", "8", "9"] {
            assert_eq!(old[node], generated[node]);
        }
    }
    #[test]
    fn generative_fake_service_matrix() {
        use crate::comfy::tests::{capabilities, preflight_reply, Reply, Server};
        for scenario in [
            "valid",
            "old-version",
            "missing-model",
            "changed-prompt",
            "wrong-job",
            "missing-output",
            "execution-failed",
            "wrong-size",
            "malformed",
            "cancel",
        ] {
            let mut i = input();
            let active = Arc::new(Active {
                id: i.request_id.clone(),
                cancel: AtomicBool::new(false),
                stage: Mutex::new("Preparing"),
            });
            let trigger = active.clone();
            let mut submitted = Value::Null;
            let server = Server::new(move |r| {
                assert!(!["/interrupt", "/queue"].contains(&r.path.as_str()));
                let mut info = capabilities();
                info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"] =
                    json!([[if scenario == "missing-model" {
                        "other.ckpt"
                    } else {
                        MODEL
                    }]]);
                if let Some(reply) = preflight_reply(
                    &r.path,
                    &info,
                    if scenario == "old-version" {
                        "0.37.0"
                    } else {
                        VERSION
                    },
                ) {
                    return reply;
                }
                if r.path == "/upload/image" {
                    let body = String::from_utf8_lossy(&r.body);
                    let filename = body
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
                    assert_eq!(submitted["prompt"]["4"]["inputs"]["text"], "red jacket");
                    assert_eq!(submitted["extra_data"]["photosuite_workflow"], WORKFLOW);
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
                    match scenario {
                        "changed-prompt" => {
                            job["workflow"]["prompt"]["4"]["inputs"]["text"] = json!("foreign")
                        }
                        "wrong-job" => job["id"] = json!("foreign"),
                        "missing-output" => job["outputs"] = json!({}),
                        "execution-failed" => job["status"] = json!("failed"),
                        "cancel" => {
                            job["status"] = json!("in_progress");
                            trigger.cancel.store(true, Ordering::SeqCst);
                        }
                        _ => {}
                    };
                    return Reply::json(job);
                }
                assert!(r.path.starts_with("/view?"));
                let w = if scenario == "wrong-size" { 520 } else { 512 };
                Reply {
                    status: 200,
                    body: if scenario == "malformed" {
                        vec![0; 5]
                    } else {
                        png_rgb(w, 512, &vec![99; w as usize * 512 * 3]).unwrap()
                    },
                    kind: "image/png",
                    extra: String::new(),
                }
            });
            i.config.endpoint = server.endpoint.clone();
            let result = run_masked(&i, &vec![255; 512 * 512 * 5], &active, Some("red jacket"));
            assert_eq!(
                result.is_ok(),
                scenario == "valid",
                "{scenario}: {:?}",
                result.as_ref().err()
            );
        }
    }
    #[test]
    #[ignore]
    fn real_generative_corpus() {
        let dir =
            std::env::var("PHOTOSUITE_GENERATIVE_CORPUS").expect("Set external evidence directory");
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(format!("{dir}/manifest.json")).unwrap())
                .unwrap();
        let mut receipts = Vec::new();
        for item in manifest["cases"].as_array().unwrap() {
            let name = item["id"].as_str().unwrap();
            let mut i = input();
            i.width = item["modelWidth"].as_u64().unwrap() as u32;
            i.height = item["modelHeight"].as_u64().unwrap() as u32;
            i.seed = item["seed"].as_u64().unwrap() as u32;
            let active = Active {
                id: i.request_id.clone(),
                cancel: AtomicBool::new(false),
                stage: Mutex::new("Preparing"),
            };
            let bytes = std::fs::read(format!("{dir}/{name}-model.bin")).unwrap();
            let start = Instant::now();
            let result =
                run_masked(&i, &bytes, &active, Some(item["prompt"].as_str().unwrap())).unwrap();
            let elapsed = start.elapsed().as_millis();
            std::fs::write(format!("{dir}/{name}-output.bin"), &result).unwrap();
            receipts.push(json!({"id":name,"requestId":i.request_id,"seed":i.seed,"width":i.width,"height":i.height,"transportMs":elapsed,"bytes":result.len()}));
            std::fs::write(
                format!("{dir}/real-receipts.json"),
                serde_json::to_vec_pretty(&receipts).unwrap(),
            )
            .unwrap();
            println!("{name}: {elapsed}ms");
        }
    }
}
