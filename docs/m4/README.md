# M4 — Prompted Object Selection

Object Selection (W) now has an **AI point / box** checkbox. Classical mode is
still the default. Enable AI, click a foreground point or drag a box, then use
Include / Exclude (or Option/Alt-click) to correct the transient preview. White
boxes, green pluses and red minuses show the accumulated prompts. **New object**
resets them. Accept creates one ordinary selection; Discard/Cancel preserve the
previous selection. Refine Edge and manual Remove Background consume the accepted
selection through their existing paths.

## Chosen model and runtime

The image-only **official SAM 2.1 Hiera Tiny** checkpoint is locally reconstructed
into two ONNX graphs. It uses the exact **ORT Web 1.22.0 single-thread WASM** assets
already bundled for M3. M3 and M4 keep separate workers, providers and model
sessions. No Python, GPU backend, video tracker, download manager, cloud or ComfyUI
fallback is introduced. M4 creates no worker or model session at startup.

[model-evaluation.json](model-evaluation.json) records the checkpoint-specific
Apache-2.0 license, upstream revisions, hashes, conversion source and outputs.
The official Meta repository is pinned at
`2b90b9f5ceec907a1c18123530e92e794ad901a4`; the official weight repository is pinned
at `de431c4043854a71d8101e17995dfe596bf101a5`. The checkpoint SHA-256 is
`7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`.

The provenance record was created before the pinned checkpoint download. No
unofficial converted weights were used. Apache license, original model card
(trailing whitespace normalized), attribution and modification notice accompany
the bundled model. Microsoft exporter/runtime MIT notices are retained.

The first full-FP32 export ran in both Node WASM and native WKWebView. Default ORT
graph optimization failed during WASM session creation; disabling it worked.
General graph FP16 conversion failed type validation. The chosen conversion stores
only float weight initializers as FP16, adds explicit casts back to FP32, and keeps
all computation and IO float32. This halves weight storage without introducing a
new runtime. FP32 ONNX vs PyTorch maximum absolute errors were below 2.4e-5 for
encoder features and 6.6e-5 for decoder logits. An initial 12-mask photograph probe
of weight storage conversion had thresholded IoU 0.997658–1.0 vs FP32. That probe
used the same encoder/weights with the original three-candidate output export;
final four-token quality/native acceptance is recorded separately.

The final encoder is **55,015,529 bytes**, decoder **8,681,263 bytes**, combined
**60.746 MiB**. Hashes are checked before session creation, and ordinary tests
verify bundled bytes against provenance. No second ORT binary is added. The
smallest SAM2.1 variant was viable, so no alternative model was evaluated.

## Contract and mapping

`segment.prompted` accepts M1-owned copied tightly packed RGBA8, source rectangle,
canvas dimensions, explicit model/settings identity, session UUID, up to 64
positive/negative points and one optional box. Points and boxes are stored in
**document coordinates**. Input is the selected raster layer's underlying pixels,
not the visible merged composite; layer masks/effects are not baked into inference.
Normal editor changes still invalidate through M0 history/source freshness.

The exact transform is:

1. Existing viewport inverse maps pointer coordinates to document coordinates,
   including pan, zoom, rotation and device pixel ratio.
2. Subtract layer origin, then independently scale X/Y to 1024×1024. The official
   SAM image path uses a square resize, **no letterbox/padding**.
3. Bilinear half-pixel RGB sampling, alpha composited against neutral 128, then
   ImageNet normalization. This implementation does not apply the upstream
   antialias filter for downsampling very large images; quality evidence below
   covers images up to 768×512. Large-image quality is a limitation.
4. Box corners use labels 2/3, positive/negative points 1/0; the upstream prompt
   wrapper adds its padding sentinel. No previous logits are required or fed back.
5. Four 256×256 logit masks return. A single click chooses highest predicted IoU
   among tokens 1–3 (first wins ties). Boxes/multiple prompts use token 0, falling
   back to best 1–3 only when its official stability score is below 0.98 (delta
   0.05). No candidate browser is added.
6. Bilinear upsample logits into the explicit source rectangle, apply sigmoid,
   multiply source alpha, round to coverage8, and clip outside the canvas. There
   is no blanket blur. These are segmentation confidence edges, not alpha matting.

## Ownership, freshness and resource bounds

The worker knows only immutable input and model tensors. It cannot access a
document or history. The application adapter captures M0 target/history/selection
identity, source metadata and a full byte copy. It compares all source words at
freshness checks, publication and Accept. A source edit, replacement, geometry,
selection or history change invalidates the session. Closed documents cannot
receive results. Switching tabs preserves source ownership; starting M4 in another
document retires the previous M4 session.

M1 session IDs and monotonically increasing revisions remain the only result
ordering authority. Replacement revokes old jobs before submitting the next one.
Already-finished previews preserve the worker and embedding for warm corrections;
replacing in-flight work terminates that worker and may re-encode. Thus rapid
clicks during the first encode are safe but not cheap. Only Accept enters M0's
existing `prepareExactResult` / `commitExactResult` selection transaction.

One M4 worker, one active source, one cached embedding. The key hashes **every
source byte** plus origin, dimensions, canvas dimensions, color/alpha contract,
preprocessing settings and model/artifact/runtime identity; ownership additionally
requires the session UUID. The three projected feature tensors total exactly
**16 MiB**: `[1,32,256,256]`, `[1,64,128,128]`, `[1,256,64,64]` float32.

Cache validity is at most 120 seconds from encoding. An expiry timer releases it
when idle, or immediately after any already-running decode completes; expired
entries are never reused. After 30 seconds without a request, the entire worker
is terminated. Accept, Discard, Cancel, stale source, close, new object and worker
failure release ownership immediately. A later correction can re-encode without
losing valid prompt metadata. Model/session tensor disposal and process RSS return
are distinct; WebKit may retain heap pages after worker termination.

Input bounds are 4,194,304 pixels per layer/canvas, axes ≤8192, origins ±8192,
64 points and one box. M1 adds its existing queue/result bounds. These bound our
retained input/cache/result objects, not total ORT/WASM allocator RSS. A 4MP RGBA
copy is 16 MiB; preprocessing is 12 MiB, embedding 16 MiB, four masks 1 MiB plus
runtime intermediate allocations. This feature is memory-intensive despite the
small embedding; see native measurements in [acceptance.md](acceptance.md).

## Reproduction and acceptance

See [scripts/m4/README.md](../../scripts/m4/README.md) for the pinned conversion and
corpus recipe, [quality.md](quality.md) for per-fixture results and limitations,
and [acceptance.md](acceptance.md) for native/offline evidence and the completion
report. Unit tests use deterministic providers/tensors, with one asset hash test;
they do not execute the large real model. No Windows/Linux execution is claimed.
