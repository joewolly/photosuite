/** Lazy, offline-only inference worker. Cancellation terminates this entire realm. */
import { SUBJECT_MODEL, SUBJECT_LIMITS, prepareSubjectTensor, reconstructSubjectMask } from "./subject-workload.js";
let session = null, ort = null, busy = false;
async function loadModel() {
  if (session) return;
  ort = await import("../../vendor/onnxruntime/ort.wasm.min.mjs");
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL("../../vendor/onnxruntime/", import.meta.url).href;
  const response = await fetch(new URL("../../vendor/subject-model/birefnet-lite-512-fp16.onnx", import.meta.url));
  if (!response.ok) throw Object.assign(new Error(), { code: "model-missing" });
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== SUBJECT_LIMITS.modelBytes) throw Object.assign(new Error(), { code: "model-corrupt" });
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)), (b) => b.toString(16).padStart(2, "0")).join("");
  if (digest !== SUBJECT_MODEL.sha256) throw Object.assign(new Error(), { code: "model-corrupt" });
  session = await ort.InferenceSession.create(new Uint8Array(buffer), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  if (session.inputNames.join() !== "input_image" || session.outputNames.join() !== "output_image") throw Object.assign(new Error(), { code: "model-corrupt" });
}
self.onmessage = async ({ data: { id, revision, input } }) => {
  if (busy) return;
  busy = true;
  let tensor, outputs;
  const progress = (stage) => self.postMessage({ id, revision, progress: { kind: "stage", stage } });
  try {
    const timings = {}, now = () => performance.now();
    progress("Preparing image"); let t = now();
    const prepared = prepareSubjectTensor(input); timings.preprocessMs = now() - t;
    progress(session ? "Finding subject" : "Loading subject selection"); t = now();
    timings.warm = !!session; await loadModel(); timings.loadMs = now() - t;
    progress("Finding subject"); t = now();
    tensor = new ort.Tensor("float32", prepared.tensor, [1, 3, 512, 512]);
    outputs = await session.run({ input_image: tensor }); timings.inferenceMs = now() - t;
    progress("Preparing preview"); t = now();
    const result = reconstructSubjectMask(input, prepared.mapping, outputs.output_image.data, outputs.output_image.dims);
    timings.reconstructMs = now() - t; result.timings = timings;
    self.postMessage({ id, revision, result }, [result.bytes.buffer]);
  } catch (error) {
    self.postMessage({ id, revision, error: { code: error.code || "inference-failure" } });
  } finally {
    tensor?.dispose();
    if (outputs) for (const output of Object.values(outputs)) output.dispose();
    busy = false;
  }
};
