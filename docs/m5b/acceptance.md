# M5b acceptance — 2026-09-28

**PASS for bounded macOS M5b.** Actual neural inference, actual Tauri interaction, exact new raster documents and provider-independent PSD/PNG reopen were exercised before the implementation commit. No Windows/Linux, hosted CI, release or universal quality claim is made.

## Environment and evidence

Apple M5, 16 GiB unified memory, macOS 27.0; ComfyUI 0.37.4, Python 3.13.12, PyTorch 2.12.1, MPS. PhotoSuite debug native bundle. Official model hash verified as documented in [setup](README.md). User explicitly authorized installing this test model externally and running ComfyUI. The workflow uses only stock nodes even though this existing installation also has unrelated optional nodes installed. No app runtime/model dependency was added.

Compact evidence is committed in `real-receipts.json`, `native-receipts.json`, `phase-profile.json` and the comparison sheets. Full raw outputs, source/model-input bytes, PSD/PNG files, harness scripts and logs are retained outside Git at `/Users/joe/Documents/Codex/2026-09-28/photosuite-m5b-acceptance/`. The temporary loopback harness serves only these test artifacts; it is not a product component.

## Native acceptance matrix

| Requirement | Evidence / result |
|---|---|
| Launch with backend absent; ordinary editing | Actual Tauri launched, backend connection refused. Final native harness applied/undid an M0 selection edit; pixels exact, selection restored to null. |
| Command, readiness, unavailable error | UI-driven Image menu → AI Upscale, Check backend; precise error and no source mutation. Final native command repeated absent-service check. |
| Start, readiness, run, progress | External official model/service started; UI Check backend ready; Run 4×; Preparing/Generating and result preview observed. |
| Cancel real inference | Instrumented existing M1 cancellation at observed Generating on the limit fixture; cancelled, no output document, source unchanged. Fast small-image UI click alone was too late and is not counted as cancellation evidence. |
| Preview/Discard | UI-driven Discard; source layer/composite/history snapshot exact and no new document. |
| Accept, dimensions, original exact | UI-driven Accept on photo; new ordinary 1204×804 full raster. Original 301×201 source pixels/layer/history unchanged. |
| Visual inspection | Actual Tauri output and lossless-model-derived comparison sheets inspected; quality caveats recorded separately. |
| Save PSD | UI File → Save As produced `m5b-ui-accepted.psd`. Transparent PSD used existing serializer/native file write through the actual webview. |
| Stop/reopen PSD/PNG | Service stopped (connection refused). Instrumented normal native file read and `FileProcessor.processLoadedBytes` opened both formats. Exact full RGBA composite hashes below. Repeated on final build with service stopped; all four passed. |
| Transparent, odd, near-limit | Real native photo301×201, transparent257×193, limit1024×512 all accepted at exact 4× with full layer extent; source snapshots exact. |
| Mutation while running | Instrumented real rendered visibility change at Generating → stale. Direct CPU-buffer edit without renderer invalidation and a no-op Clear probe were invalid test stimuli, not accepted evidence. |
| Tab switch | Instrumented existing tab selection while limit job ran; Accept created 4096×2048 for captured limit source, never redirected to active photo. Source exact. |
| Close while running | Final native run used complete `splashScreen.detachPanelAt` tab-close path at Generating: cancelled, source removed, document count decreased by exactly one, no late creation. Earlier isolated close-handler probe was superseded. |
| Cancel result assembly | Final build cancelled at Restoring transparency: terminal cancelled, no new document. |

Native instrumentation uses the production M1/provider/Rust commands and normal document/save/import code inside the actual Tauri webview. It does not replace the backend or call a browser mock. UI-driven and instrumented portions are intentionally distinguished. Early harness attempts and duplicate observer subscriptions remain in the external chronological log; final pass receipts identify the accepted runs.

## Saved pixels

| Image | Canvas | Full RGBA SHA-256, identical before save / PSD reopen / PNG reopen |
|---|---|---|
| Photograph | 1204×804 | `ea4f8df69abc9a3bcb0a5809f2b2f627662ff9594db9dede028db5388d8f31ce` |
| Transparent asset | 1028×772 | `a408f81d1e094ed308c02a3a9ef5db6d901594fb2d470db686b092acd15c1dc0` |

Photo PSD 4,920,496 bytes; PNG 1,902,831 bytes. Transparent PSD 1,292,396 bytes; PNG 338,444 bytes. PSD preserves the full raster-layer extent. Normal PNG import may trim a layer's transparent margin (108,88,805,573 in this case) while preserving exact full canvas/composite/alpha. Final optimized native output hashes exactly match the earlier saved outputs. The original photo layer/composite hash was `a0bc6230b8b93a084e7553667b492ae7f250dca03594a223defb869891e3b0a5`, with one initial history entry/index0 in the UI acceptance run.

## Real inference and performance

All 12 corpus cases ran through the production Rust upscale transport. Exact dimensions and byte sizes are in `real-receipts.json`; limit output is 4096×2048 / 33,554,432 bytes. Corpus transport totals were 299–634 ms for smaller warm samples, 2,141 ms at the limit. These include preflight, encoding, upload, polling, inference, download and decode; they are not isolated inference timings.

Final native timings (ms, one run each, inspector/observers active):

| Source | Capture | RGB extension | Native transport total | Alpha assembly including cooperative yields | Thumbnail | New document |
|---|---:|---:|---:|---:|---:|---:|
| Photo 301×201 | 2 | 8 | 852 | 126 | 2 | 11 |
| Transparent 257×193 | 2 | 5 | 1002 | 267 | 2 | 10 |
| Limit 1024×512 | 16 | 38 | 2050 | 452 | 1 | 68 |

A separate diagnostic client profiled the same four stock nodes via ComfyUI websocket execution events, with a freshly restarted owned server for the cold row. It uses Python/PIL encode/decode, so its encode/decode numbers **are not Rust/Tauri implementation timings**. They separate backend stages without altering shipping transport. “Inference” below includes the stock upscale node's device transfer/tiling/reassembly; “model load” is the loader-node interval, with additional device setup potentially in the first inference. Warm model loader was cached. Queue is submission-to-execution-start with an empty server. This is not a pure kernel benchmark.

| Diagnostic case | PNG encode | Upload | Queue | Model load | Upscale node | Save node | Download | PNG decode/RGBA |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Photo cold | 8.73 | 4.05 | 2.79 | 14.06 | 211.49 | 36.33 | 1.08 | 10.94 |
| Photo warm | 2.38 | 1.28 | 1.24 | cached | 80.81 | 31.60 | 0.93 | 10.48 |
| Limit warm | 22.16 | 2.14 | 1.27 | cached | 417.07 | 272.50 | 3.38 | 82.28 |

Diagnostic PNG transfer: photo 1,182,300 bytes; limit 8,764,809 bytes. Full phase event data is in `phase-profile.json`. Repeated inference can be cached by ComfyUI, so unique upload filenames were used for these measurements.

One-second RSS sampling across corpus/native sessions observed PhotoSuite host peak 242,080 KiB (~236 MiB), main WebContent process launched with the app peak 1,171,872 KiB (~1144 MiB), another WebContent/inspector process 225,312 KiB (~220 MiB), and ComfyUI peak 1,127,728 KiB (~1101 MiB). These are session maxima including loaded documents/inspector/caches, not per-job allocation deltas; brief peaks can be missed. Other WebContent processes and compiler RSS were excluded from app claims. MPS system_stats reports unified-memory total/free (16 GiB total, ~5.47 GiB free in the retained final sample), not reliable per-operation GPU allocation; no isolated GPU peak is claimed. No OOM occurred at the bound. These observations support the conservative v1 cap but do not establish performance on smaller/different hardware or with many documents open.

## Validation and packaging

- `npm test`: **2023 passed**, including 34 M5b tests.
- `npm run lint`: PASS.
- `npm run verify`: PASS (imports, bindings, cycles, statics, shadows, prototypes, format wiring, bootstrap).
- `cargo test`: **22 passed, 1 opt-in live test ignored** in normal suite; live corpus explicitly run separately and passed.
- `cargo check`: PASS.
- `rustfmt --check --edition 2021` on modified/new Comfy modules: PASS. `lib.rs` adds only two correctly indented command registrations; unrelated pre-existing whole-file formatting drift was not rewritten.
- Native Tauri debug bundle build: PASS. `git diff --check`: PASS.

Added deterministic tests cover safe bounds/odd/overflow/unsupported2×, alpha opaque/hard/soft/partial, hidden RGB containment, async cancellation, malformed/wrong-sized output, new document extent, PSD bytes, source freshness/history/close/tab switch, one retained result, thumbnail, and actual interpolation determinism. Rust fake-service cases cover schema/version/model, identity/graph mismatch, restart, output bounds/format, queued/running/download cancellation. Existing shared M2 transport tests cover timeout and transport policy; M0–M4 regression suite remains passing.

Same debug bundle baseline at accepted M4: 272,024 KiB; M5b: 272,428 KiB; **+404 KiB (~0.15%)**, measured by `du -sk`. No upscale weights/runtime bundled. This is a local debug bundle size, not a signed release/DMG size. No hosted CI, signing, notarization, installation, release or cross-platform acceptance was performed.
