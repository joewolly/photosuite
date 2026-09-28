import { runQuickSelectWorkload } from "./quick-select-workload.js";

self.onmessage = ({ data }) => {
  const { id, revision, input } = data;
  try {
    const result = runQuickSelectWorkload(input, (progress) => self.postMessage({ id, revision, progress }));
    self.postMessage({ id, revision, result }, [result.bytes.buffer]);
  } catch {
    self.postMessage({ id, revision, error: true });
  }
};
