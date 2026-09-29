//! M8 uses the reviewed M6 graph and checkpoint, with a distinct fixed operation identity.
use super::*;
pub const WORKFLOW: &str = "photosuite-generative-expand-v1";
#[tauri::command]
pub async fn comfy_expand_preflight(config: Config) -> Result<Capability, String> {
    let mut result = generative::comfy_generative_preflight(config).await?;
    result.workflow = WORKFLOW;
    Ok(result)
}
#[tauri::command]
pub async fn comfy_expand(
    request: tauri::ipc::Request<'_>,
    state: tauri::State<'_, ComfyState>,
) -> Result<tauri::ipc::Response, String> {
    generative::invoke_masked(request, state, WORKFLOW).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_expand_contract() {
        let input = Input {
            request_id: uuid::Uuid::new_v4().to_string(),
            config: Config {
                enabled: true,
                endpoint: "http://127.0.0.1:8188".into(),
                checkpoint: generative::MODEL.into(),
            },
            width: 512,
            height: 512,
            seed: 42,
        };
        assert_ne!(WORKFLOW, generative::WORKFLOW);
        assert_eq!(
            masked_workflow(&input, Some("continue sky"))["4"]["inputs"]["text"],
            "continue sky"
        );
        assert!(validate_input(&input, 512 * 512 * 5).is_ok());
        assert!(validate_input(&input, 512 * 512 * 5 + 1).is_err());
    }
    #[test]
    #[ignore]
    fn real_expand_corpus() {
        let dir =
            std::env::var("PHOTOSUITE_EXPAND_CORPUS").expect("Set external evidence directory");
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(format!("{dir}/manifest.json")).unwrap())
                .unwrap();
        let mut receipts = Vec::new();
        for item in manifest["cases"].as_array().unwrap() {
            let name = item["id"].as_str().unwrap();
            let input = Input {
                request_id: uuid::Uuid::new_v4().to_string(),
                config: Config {
                    enabled: true,
                    endpoint: "http://127.0.0.1:8188".into(),
                    checkpoint: generative::MODEL.into(),
                },
                width: item["modelWidth"].as_u64().unwrap() as u32,
                height: item["modelHeight"].as_u64().unwrap() as u32,
                seed: item["seed"].as_u64().unwrap() as u32,
            };
            let active = Active {
                id: input.request_id.clone(),
                cancel: AtomicBool::new(false),
                stage: Mutex::new("Preparing"),
            };
            let data = std::fs::read(format!("{dir}/{name}-model.bin")).unwrap();
            let started = Instant::now();
            let output = run_masked_as(
                &input,
                &data,
                &active,
                Some(item["prompt"].as_str().unwrap()),
                WORKFLOW,
            )
            .unwrap();
            let elapsed = started.elapsed().as_millis();
            std::fs::write(format!("{dir}/{name}-output.bin"), &output).unwrap();
            receipts.push(json!({"id":name,"requestId":input.request_id,"seed":input.seed,"workflow":WORKFLOW,"model":generative::MODEL,"width":input.width,"height":input.height,"bytes":output.len(),"transportMs":elapsed}));
            std::fs::write(
                format!("{dir}/real-receipts.json"),
                serde_json::to_vec_pretty(&receipts).unwrap(),
            )
            .unwrap();
            println!("{name}: {elapsed}ms");
        }
    }
}
