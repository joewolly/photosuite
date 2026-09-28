use super::*;
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    thread,
};

pub(super) struct Request {
    pub(super) path: String,
    pub(super) method: String,
    pub(super) body: Vec<u8>,
}
pub(super) struct Reply {
    pub(super) status: u16,
    pub(super) body: Vec<u8>,
    pub(super) kind: &'static str,
    pub(super) extra: String,
}
impl Reply {
    pub(super) fn json(value: Value) -> Self {
        Self {
            status: 200,
            body: serde_json::to_vec(&value).unwrap(),
            kind: "application/json",
            extra: String::new(),
        }
    }
}
pub(super) struct Server {
    pub(super) endpoint: String,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Server {
    pub(super) fn new(mut handler: impl FnMut(Request) -> Reply + Send + 'static) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let thread = thread::spawn(move || {
            for connection in listener.incoming() {
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                let mut stream = connection.unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut first = String::new();
                reader.read_line(&mut first).unwrap();
                let fields: Vec<_> = first.split_whitespace().collect();
                if fields.len() < 2 {
                    continue;
                }
                let (method, path) = (fields[0].into(), fields[1].into());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let reply = handler(Request { path, method, body });
                let headers = format!("HTTP/1.1 {} Test\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n", reply.status, reply.kind, reply.body.len(), reply.extra);
                let _ = stream.write_all(headers.as_bytes());
                let _ = stream.write_all(&reply.body);
            }
        });
        Self {
            endpoint: format!("http://{address}"),
            stop,
            thread: Some(thread),
        }
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.endpoint.strip_prefix("http://").unwrap());
        self.thread.take().unwrap().join().unwrap();
    }
}
fn input(url: &str) -> Input {
    Input {
        request_id: uuid::Uuid::new_v4().to_string(),
        config: Config {
            enabled: true,
            endpoint: url.into(),
            checkpoint: "acceptance.safetensors".into(),
        },
        width: 512,
        height: 512,
        seed: 42,
    }
}
fn active(input: &Input) -> Arc<Active> {
    Arc::new(Active {
        id: input.request_id.clone(),
        cancel: AtomicBool::new(false),
        stage: Mutex::new("Preparing"),
    })
}
// Reviewed v0.37.0 built-in signatures, independent of graph construction.
fn capabilities() -> Value {
    json!({
        "CheckpointLoaderSimple":{"output":["MODEL","CLIP","VAE"],"input":{"required":{"ckpt_name":[["acceptance.safetensors"]]}}},
        "LoadImage":{"output":["IMAGE","MASK"],"input":{"required":{"image":[[],{"image_upload":true}]}}},
        "LoadImageMask":{"output":["MASK"],"input":{"required":{"image":[[],{"image_upload":true}],"channel":[["alpha","red","green","blue"]]}}},
        "CLIPTextEncode":{"output":["CONDITIONING"],"input":{"required":{"text":["STRING"],"clip":["CLIP"]}}},
        "InpaintModelConditioning":{"output":["CONDITIONING","CONDITIONING","LATENT"],"input":{"required":{"positive":["CONDITIONING"],"negative":["CONDITIONING"],"vae":["VAE"],"pixels":["IMAGE"],"mask":["MASK"],"noise_mask":["BOOLEAN"]}}},
        "KSampler":{"output":["LATENT"],"input":{"required":{"model":["MODEL"],"seed":["INT",{"min":0}],"steps":["INT",{"min":1,"max":10000}],"cfg":["FLOAT",{"min":0,"max":100}],"sampler_name":[["euler"]],"scheduler":[["normal"]],"positive":["CONDITIONING"],"negative":["CONDITIONING"],"latent_image":["LATENT"],"denoise":["FLOAT",{"min":0,"max":1}]}}},
        "VAEDecode":{"output":["IMAGE"],"input":{"required":{"samples":["LATENT"],"vae":["VAE"]}}},
        "SaveImage":{"output":["IMAGE"],"output_node":true,"input":{"required":{"images":["IMAGE"],"filename_prefix":["STRING"]}}}
    })
}
pub(super) fn preflight_reply(path: &str, info: &Value, version: &str) -> Option<Reply> {
    if path == "/system_stats" {
        return Some(Reply::json(json!({"system":{"comfyui_version":version}})));
    }
    path.strip_prefix("/object_info/")
        .map(|class| Reply::json(json!({class:info[class]})))
}
#[test]
fn literal_loopback_only() {
    for good in [
        "http://127.0.0.1:8188",
        "http://127.0.0.1:1/",
        "http://[::1]:65535",
    ] {
        assert!(endpoint(good).is_ok(), "{good}");
    }
    for bad in [
        "http://localhost:8188",
        "http://localhost.evil:8188",
        "http://127.0.0.1.evil:1",
        "https://127.0.0.1:1",
        "http://127.1:1",
        "http://2130706433:1",
        "http://0x7f000001:1",
        "http://127.0.0.1:0",
        "http://127.0.0.1:65536",
        "http://127.0.0.1:1/a",
        "http://127.0.0.1:1//",
        "http://127.0.0.1:1?x",
        "http://127.0.0.1:1#x",
        "http://user@127.0.0.1:1",
        "http://192.168.1.2:8188",
        "http://[::ffff:127.0.0.1]:1",
    ] {
        assert!(endpoint(bad).is_err(), "{bad}");
    }
}
#[test]
fn preflight_variants() {
    for scenario in [
        "valid",
        "supported-older",
        "version",
        "missing-node",
        "missing-model",
        "malformed",
        "wrong-type",
        "range",
        "new-required",
    ] {
        let mut info = capabilities();
        match scenario {
            "missing-node" => {
                info.as_object_mut().unwrap().remove("VAEDecode");
            }
            "missing-model" => {
                info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"] =
                    json!([["different.safetensors"]])
            }
            "malformed" => info["KSampler"]["input"]["required"] = Value::Null,
            "wrong-type" => info["KSampler"]["input"]["required"]["model"] = json!(["STRING"]),
            "range" => info["KSampler"]["input"]["required"]["steps"] = json!(["INT",{"max":10}]),
            "new-required" => info["KSampler"]["input"]["required"]["surprise"] = json!(["INT"]),
            _ => {}
        }
        let server = Server::new(move |r| {
            preflight_reply(
                &r.path,
                &info,
                if scenario == "version" {
                    "0.36.0"
                } else if scenario == "supported-older" {
                    "0.37.0"
                } else {
                    VERSION
                },
            )
            .unwrap()
        });
        let result = preflight(&client().unwrap(), &input(&server.endpoint).config, None);
        assert_eq!(
            result.is_ok(),
            ["valid", "supported-older"].contains(&scenario),
            "{scenario}"
        );
    }
}
#[test]
fn unreachable_and_malformed_and_redirect_not_followed() {
    let closed = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    assert!(preflight(&client().unwrap(), &input(&url).config, None).is_err());
    let server = Server::new(|_| Reply {
        status: 200,
        body: b"no json".to_vec(),
        kind: "application/json",
        extra: String::new(),
    });
    assert!(preflight(&client().unwrap(), &input(&server.endpoint).config, None).is_err());
    let count = Arc::new(Mutex::new(0));
    let observed = count.clone();
    let destination = Server::new(move |_| {
        *observed.lock().unwrap() += 1;
        Reply::json(json!({}))
    });
    let location = destination.endpoint.clone();
    let redirect = Server::new(move |_| Reply {
        status: 302,
        body: vec![],
        kind: "text/plain",
        extra: format!("Location: {location}/leak\r\n"),
    });
    assert!(preflight(&client().unwrap(), &input(&redirect.endpoint).config, None).is_err());
    assert_eq!(*count.lock().unwrap(), 0);
}
#[test]
fn resource_and_png_limits_and_polarity() {
    let mut i = input("http://127.0.0.1:8188");
    assert!(validate_input(&i, 512 * 512 * 5).is_ok());
    assert!(validate_input(&i, 4).is_err());
    i.width = 1025;
    assert!(validate_input(&i, 0).is_err());
    i.width = 512;
    i.request_id = "foreign".into();
    assert!(validate_input(&i, 512 * 512 * 5).is_err());
    let mut data = vec![0; 512 * 512 * 5];
    data[512 * 512 * 4 + 1] = 1;
    let (source, mask) = encode_inputs(&i, &data).unwrap();
    assert_eq!(&decode_output(&source, 512, 512).unwrap()[..4], &[255; 4]); // transparent -> white
    assert_eq!(
        &decode_output(&mask, 512, 512).unwrap()[..8],
        &[0, 0, 0, 255, 255, 255, 255, 255]
    );
    assert!(decode_output(&mask, 520, 512).is_err());
    assert!(decode_output(b"not a png", 512, 512).is_err());
    assert!(decode_output(&vec![0; MAX_PNG + 1], 512, 512).is_err());
}
#[test]
fn bounded_response_and_request_timeout() {
    let server = Server::new(|_| Reply {
        status: 200,
        body: vec![b' '; MAX_JSON + 1],
        kind: "application/json",
        extra: String::new(),
    });
    assert!(get(&client().unwrap(), &server.endpoint)
        .unwrap_err()
        .contains("size limit"));
    let delayed = Server::new(|_| {
        thread::sleep(Duration::from_millis(100));
        Reply::json(json!({}))
    });
    let short = Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(20))
        .build()
        .unwrap();
    assert!(get(&short, &delayed.endpoint)
        .unwrap_err()
        .contains("timed out"));
}
#[test]
fn transport_protocol_and_failures() {
    for scenario in [
        "valid",
        "equivalent-numbers",
        "changed-graph",
        "wrong-submit-id",
        "queue-rejected",
        "wrong-job-id",
        "missing-output",
        "foreign-output",
        "foreign-workflow",
        "wrong-dimensions",
        "malformed-image",
        "wrong-format",
        "server-error",
        "restart",
        "cancel-submit",
        "cancel-queued",
        "cancel-running",
    ] {
        let record = Arc::new(Mutex::new(Vec::new()));
        let seen = record.clone();
        let cancel_slot: Arc<Mutex<Option<Arc<Active>>>> = Arc::new(Mutex::new(None));
        let trigger = cancel_slot.clone();
        let mut submitted = Value::Null;
        let mut polls = 0;
        let server = Server::new(move |r| {
            seen.lock()
                .unwrap()
                .push((r.method.clone(), r.path.clone()));
            if let Some(reply) = preflight_reply(&r.path, &capabilities(), VERSION) {
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
                assert!(filename.starts_with("photosuite-"));
                let png_start = r
                    .body
                    .windows(8)
                    .position(|b| b == b"\x89PNG\r\n\x1a\n")
                    .unwrap();
                let decoded = decode_output(&r.body[png_start..], 512, 512).unwrap();
                if filename.ends_with("-mask.png") {
                    assert_eq!(&decoded[..8], &[255, 255, 255, 255, 0, 0, 0, 255]);
                } else {
                    assert_eq!(&decoded[..4], &[12, 34, 56, 255]);
                }
                return Reply::json(json!({"name":filename,"subfolder":"","type":"input"}));
            }
            if r.path == "/prompt" {
                submitted = serde_json::from_slice(&r.body).unwrap();
                assert_eq!(submitted["prompt"]["7"]["inputs"]["steps"], 20);
                assert_eq!(submitted["prompt"]["3"]["inputs"]["channel"], "red");
                if scenario == "cancel-submit" {
                    trigger
                        .lock()
                        .unwrap()
                        .as_ref()
                        .unwrap()
                        .cancel
                        .store(true, Ordering::SeqCst);
                }
                let mut reply = Reply::json(
                    json!({"prompt_id":if scenario == "wrong-submit-id" { "foreign" } else { submitted["prompt_id"].as_str().unwrap() },"number":1,"node_errors":{}}),
                );
                if scenario == "queue-rejected" {
                    reply.status = 400;
                }
                return reply;
            }
            if r.path.ends_with("/cancel") {
                assert_eq!(
                    r.path,
                    format!(
                        "/api/jobs/{}/cancel",
                        submitted["prompt_id"].as_str().unwrap()
                    )
                );
                return Reply::json(json!({"cancelled":true}));
            }
            if r.path.starts_with("/api/jobs/") {
                polls += 1;
                let id = submitted["prompt_id"].as_str().unwrap();
                let status = if polls == 1 {
                    "pending"
                } else if polls == 2 {
                    "in_progress"
                } else {
                    "completed"
                };
                if (scenario == "cancel-queued" && polls == 1)
                    || (scenario == "cancel-running" && polls == 2)
                {
                    trigger
                        .lock()
                        .unwrap()
                        .as_ref()
                        .unwrap()
                        .cancel
                        .store(true, Ordering::SeqCst);
                }
                let mut job = json!({"id":id,"status":status,"workflow":{"prompt":submitted["prompt"],"extra_data":submitted["extra_data"]},
                    "outputs":{"9":{"images":[{"filename":format!("photosuite-{id}_00001_.png"),"subfolder":"","type":"output"}]}}});
                match scenario {
                    "equivalent-numbers" => {
                        job["workflow"]["prompt"]["7"]["inputs"]["cfg"] = json!(7);
                        job["workflow"]["prompt"]["7"]["inputs"]["denoise"] = json!(1);
                    }
                    "changed-graph" => job["workflow"]["prompt"]["7"]["inputs"]["cfg"] = json!(8),
                    "wrong-job-id" => job["id"] = json!("foreign"),
                    "missing-output" => job["outputs"] = json!({}),
                    "foreign-output" => {
                        job["outputs"]["9"]["images"][0]["filename"] = json!("foreign.png")
                    }
                    "foreign-workflow" => {
                        job["workflow"]["extra_data"]["photosuite_request_id"] = json!("foreign")
                    }
                    "server-error" => job["status"] = json!("failed"),
                    _ => {}
                }
                let mut reply = Reply::json(job);
                if scenario == "restart" {
                    reply.status = 404;
                }
                return reply;
            }
            assert!(r.path.starts_with("/view?"));
            let width = if scenario == "wrong-dimensions" {
                520
            } else {
                512
            };
            Reply {
                status: 200,
                body: if scenario == "malformed-image" {
                    b"broken".to_vec()
                } else {
                    png_rgb(width, 512, &vec![99; width as usize * 512 * 3]).unwrap()
                },
                kind: if scenario == "wrong-format" {
                    "image/jpeg"
                } else {
                    "image/png"
                },
                extra: String::new(),
            }
        });
        let i = input(&server.endpoint);
        let a = active(&i);
        *cancel_slot.lock().unwrap() = Some(a.clone());
        let mut bytes = [12, 34, 56, 255].repeat(512 * 512);
        bytes.extend(vec![0; 512 * 512]);
        bytes[512 * 512 * 4] = 127;
        let result = run(&i, &bytes, &a);
        let success = ["valid", "equivalent-numbers"].contains(&scenario);
        assert_eq!(
            result.is_ok(),
            success,
            "{scenario}: {:?}",
            result.as_ref().err()
        );
        if success {
            assert_eq!(&result.unwrap()[..4], &[99, 99, 99, 255]);
        }
        let paths = record.lock().unwrap();
        assert!(!paths
            .iter()
            .any(|(_, p)| p == "/interrupt" || p == "/queue" || p == "/api/jobs/cancel"));
        assert_eq!(
            paths.iter().filter(|(_, p)| p.ends_with("/cancel")).count(),
            usize::from(!success)
        );
        assert_eq!(paths.iter().filter(|(_, p)| p == "/prompt").count(), 1);
    }
}
#[test]
fn lease_releases_and_cancel_is_owned() {
    let state = ComfyState::default();
    let lease = state.acquire("a").unwrap();
    assert!(state.acquire("b").is_err());
    assert_eq!(state.0.lock().unwrap().as_ref().unwrap().id, "a");
    lease.active.cancel.store(true, Ordering::SeqCst);
    assert!(lease.active.check().is_err());
    drop(lease);
    assert!(state.0.lock().unwrap().is_none());
    assert!(state.acquire("b").is_ok());
}
