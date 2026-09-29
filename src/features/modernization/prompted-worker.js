/** Image-only SAM 2.1. One lazy realm, one source embedding, no editor authority. */
import { PROMPTED_MODEL, PROMPTED_LIMITS, PromptedEmbeddingCache, promptedSourceKey, preparePromptedImage, preparePromptTensors, reconstructPromptedMask } from "./prompted-workload.js";
let ort, encoder, decoder, busy = false, expiryTimer, expired = false;
const cache = new PromptedEmbeddingCache();
async function loadArtifact(name, bytes, sha256) {
  const response = await fetch(new URL(`../../vendor/prompted-model/${name}.onnx`, import.meta.url));
  if (!response.ok) throw Object.assign(new Error(), { code: "model-missing" });
  const buffer = await response.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (buffer.byteLength !== bytes || hash !== sha256) throw Object.assign(new Error(), { code: "model-corrupt" });
  // ORT 1.22's default graph optimization throws for this export in WASM.
  return ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders: ["wasm"], graphOptimizationLevel: "disabled" });
}
async function load() {
  if (encoder && decoder) return;
  ort = await import("../../vendor/onnxruntime/ort.wasm.min.mjs");
  ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL("../../vendor/onnxruntime/", import.meta.url).href;
  encoder = await loadArtifact("encoder", 55015529, PROMPTED_MODEL.encoderSha256);
  decoder = await loadArtifact("decoder", 8681263, PROMPTED_MODEL.decoderSha256);
  if (encoder.inputNames.join() !== "image" || encoder.outputNames.join() !== "image_features_0,image_features_1,image_embeddings"
    || decoder.inputNames.join() !== "image_features_0,image_features_1,image_embeddings,point_coords,point_labels" || decoder.outputNames.join() !== "low_res_masks,iou_predictions") throw Object.assign(new Error(), { code: "model-corrupt" });
}
const dispose = (tensors) => { for (const value of Object.values(tensors)) value.dispose(); };
self.onmessage = async ({ data: { id, revision, input } }) => {
  if (busy) return;
  busy = true;
  let image, points, labels, outputs;
  const progress = (stage) => self.postMessage({ id, revision, progress: { kind: "stage", stage } });
  try {
    const timings = {}, now = () => performance.now();
    progress("Checking image"); let t = now();
    const key = await promptedSourceKey(input); timings.hashMs = now() - t;
    t = now(); progress(encoder ? "Preparing object selection" : "Loading object selection");
    await load(); timings.loadMs = now() - t;
    let features = cache.get(key, input.sessionId); timings.embeddingReused = !!features;
    if (!features) {
      t = now(); progress("Preparing image");
      image = new ort.Tensor("float32", preparePromptedImage(input), [1, 3, 1024, 1024]); timings.preprocessMs = now() - t;
      t = now(); progress("Encoding image — corrections will be faster");
      features = await encoder.run({ image }); timings.encoderMs = now() - t;
      const expected = [[1, 32, 256, 256], [1, 64, 128, 128], [1, 256, 64, 64]];
      if (Object.values(features).some((v, i) => v.dims.join() !== expected[i].join() || !(v.data instanceof Float32Array))) { dispose(features); throw new Error("Invalid embedding"); }
      cache.put(key, input.sessionId, features, Object.values(features).reduce((n, v) => n + v.data.byteLength, 0), dispose);
      clearTimeout(expiryTimer); expired = false;
      expiryTimer = setTimeout(() => { expired = true; if (!busy) cache.clear(); }, PROMPTED_LIMITS.cacheMs);
    }
    timings.embeddingBytes = cache.entry.bytes;
    progress("Selecting object"); t = now();
    const prompt = preparePromptTensors(input);
    points = new ort.Tensor("float32", prompt.coords, [1, prompt.labels.length, 2]);
    labels = new ort.Tensor("int32", prompt.labels, [1, prompt.labels.length]);
    outputs = await decoder.run({ ...features, point_coords: points, point_labels: labels }); timings.decoderMs = now() - t;
    progress("Preparing preview"); t = now();
    if (outputs.low_res_masks.dims.join() !== "1,4,256,256" || outputs.iou_predictions.dims.join() !== "1,4") throw new Error("Invalid decoder output");
    const result = reconstructPromptedMask(input, outputs.low_res_masks.data, outputs.iou_predictions.data);
    timings.reconstructMs = now() - t; result.timings = timings; result.sourceKey = key;
    self.postMessage({ id, revision, result }, [result.bytes.buffer]);
  } catch (error) { cache.clear(); self.postMessage({ id, revision, error: { code: error.code || "inference-failure" } }); }
  finally { image?.dispose(); points?.dispose(); labels?.dispose(); if (outputs) dispose(outputs); busy = false; if (expired) cache.clear(); }
};
