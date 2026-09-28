# Developer-only M4 evaluation

Nothing in this folder runs in the product. Model download is deliberately not
part of startup or CI. Inspect `docs/m4/model-evaluation.json` and its license
record before retrieving the exact pinned upstream inputs.

Use Python 3.12.14 with `torch==2.5.1`, `torchvision==0.20.1`, `onnx==1.17.0`,
`onnxruntime==1.22.0`, `hydra-core==1.3.2`, `iopath==0.1.10`, numpy and Pillow.
The full evaluation environment versions are in `conversion-requirements.txt`.

Prepare a work directory containing:

- `sam2/`, a clean clone at the `codeRevision` in the provenance record.
- `sam2.1_hiera_tiny.pt`, downloaded from the official HF repository at the pinned
  `weightsRevision`, verified against `checkpointSha256` before loading.
- `ort-export/`, the listed Python files from the Microsoft repository at the
  pinned `conversionSource` commit, with their exact recorded SHA-256 hashes.

Then run from the repository root (substitute your work directory):

```sh
python scripts/m4/export-sam2.py --work /tmp/photosuite-m4-evaluation
```

The script rejects mismatched checkpoint, dirty/unpinned Meta source or altered
Microsoft wrappers, exports opset17 FP32 graphs, checks ONNX and compares CPU
outputs to PyTorch, then converts weight storage to FP16 plus FP32 casts. It emits
`encoder-fp16.onnx`, `decoder-fp16.onnx`, `conversion.json`, `fp16.json`. Compare
final SHA-256 to the recorded bundled hashes before copying to
`src/vendor/prompted-model/{encoder,decoder}.onnx`. Retain the licenses and notices.

Rebuild/evaluate the reviewed fixture corpus:

```sh
python scripts/m4/create-corpus.py /tmp/photosuite-m4-evaluation/corpus-raw
node scripts/m4/evaluate.mjs /tmp/photosuite-m4-evaluation/corpus-raw /tmp/photosuite-m4-evaluation/corpus-results
python scripts/m4/render-evaluation.py /tmp/photosuite-m4-evaluation/corpus-results docs/m4/evidence
```

The generator reuses already-reviewed M3 fixtures; it does not download images.
The real-model runner uses production preprocessing/reconstruction and bundled ORT
Web WASM. It is explicitly an opt-in **Node** evidence lane. Native acceptance
uses the packaged worker, documented separately, not this runner.
