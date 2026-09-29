# M8 acceptance — 2026-09-28 (America/Denver)

Local acceptance passed on branch `codex/m8-generative-expand`, based exactly on accepted M7 `420162e503effab5b0d10985ab70d2e8e2bdad53`. No push, merge, tag, release or installation was performed. The primary M7 checkout's existing roadmap edit and M5a files were left untouched. Work was isolated in the attached M8 worktree.

## Geometry audit and decision

The actual canvas path is `CropToolBase.redo/undo` in `src/document/tools/crop-tools.js` → `resizeDocumentCanvas` in `src/document/model/layer-translate.js` → `translateLayersByDelta` / `applyLayerTranslations`. Raster bounds and raster-mask bounds use the same integer delta; guides move by that delta. Existing crop history separately snapshots slices and transforms document paths/extra channels. Those broader crop responsibilities are not implicitly supplied by canvas resize alone. The resize helper offsets extra-channel rectangles but does not establish new document-size channel coverage. Accordingly, M8 excludes paths, channels, slices, selections, artboards and semantic layer structures rather than claiming their translation is safe.

M8 calls the existing canvas helper only on a detached bounded snapshot. It verifies source pixels and the mapped original composite, then installs geometry and the exterior raster within one rollback boundary. It does not reuse a standalone crop history entry, modify the crop engine, or add a general transaction framework. See [shipping contract](README.md).

## Automated and build evidence

| Check | Result |
| --- | --- |
| `npm test` | 2,116 tests / 422 suites; 0 failures, 0 skipped |
| Focused M8 tests | 45 passed, including reopened PSD/PSB group expansion |
| `npm run lint` | Passed |
| `npm run verify` | Passed all import, binding, cycle, static, shadow, prototype, format and bootstrap checks |
| `git diff --check` | Passed |
| Relevant Rust tests | 25 passed; 3 explicitly opt-in real-service tests ignored in normal run |
| `cargo check` | Passed |
| rustfmt on changed Comfy modules | Passed |
| Native Tauri debug `.app` build | Passed; unsigned development build, not notarized/released |

Deterministic coverage includes every direction, odd sizes, overflow/bounds, unsupported structures, padding, malicious interior output containment, off-canvas layers, groups, raster-mask density/link/enabled/outside coverage, guides, cancellation/late output, stale pixels/history/geometry/masks, tab isolation, close, normal history branching, and PSD/PSB recomposition. Fault injection covers snapshot, detached resize, partial translation, insertion, live tree rebuild, and history finalization. Failure preserves geometry, source/masks, composite, prior redo branch, saved index, and history. M0–M7 regression suites remain passing.

## Actual backend and quality

The 16-case corpus used the **production Rust M2 transport** and fixed M8 workflow, not a fake service. ComfyUI 0.37.4, source revision `8ff6dc384ba5c410266b40e137799e049459d4f2`, ran on numeric loopback with the existing SD 1.5 inpainting checkpoint. Its freshly verified SHA-256 was `c6bbc15e3224e6973459ba78de4998b80b50112b0ae5b5c67113d56b4e366b19`. No model was added or bundled.

All 16 outputs completed. All had zero changed bytes in the mapped original rectangle, identical source buffers, exact stored-byte Undo/Redo, and PSD/PSB raster/geometry/recomposed-composite equality. [Manifest](corpus-manifest.json), [transport receipts](real-receipts.json), [containment receipts](containment-receipts.json), and [comparison images / quality findings](quality.md) retain the evidence. Visual assessment: **6 useful simple continuations, 6 mixed, 4 failures**. This is a small correlated corpus, partly synthetic; it does not establish general photographic or perspective reconstruction quality. User preview is mandatory.

## Actual native Tauri acceptance

The app was built from this branch and launched from `/tmp/photosuite-m8-target/debug/bundle/macos/PhotoSuite.app`. Computer Use operated native menus/buttons and the native Web Inspector. Instrumented checks called the actual app's command/job/history/loader objects and production Tauri IPC; no fake provider or browser-only substitute was used. Instrumentation lived in external files, not product hooks.

| Native scenario | Interaction and evidence |
| --- | --- |
| Start with ComfyUI stopped; invoke Expand; useful error/no mutation | Direct Image menu/dialog/backend-check; instrumented exact snapshot |
| Right-side generation, preview and Discard | Direct dialog/Generate/Discard; exact unchanged dimensions, pixels and history |
| Right-side rerun/Accept, original projection, one undo entry | Real production rerun; direct Accept; instrumented hashes/history |
| Undo, stop backend, Redo | Direct Edit menu controls; exact snapshots, no inference |
| Left, top, bottom, two sides, four sides; empty prompt; transparent source | Instrumented actual native jobs and acceptance; exact preview/source/geometry and saved results |
| Multiple layers, group, negative bounds, raster mask, translated guides | Instrumented real generation and exact history/PSD/PSB checks |
| Artboard rejection | Instrumented; no job, no mutation |
| Injected post-history-finalization failure | Instrumented real result; full live rollback, no stray entry |
| Cancel while generating | Instrumented lifecycle test plus direct native Cancel; no late preview/mutation |
| Source edit while generating, tab switch, source close | Instrumented real jobs; stale result rejected, source-only target, closed document has no late mutation |
| M6 Generative Fill / M7 provenance | Real native fill accepted; passive recipe persisted; PSD/PSB reopened offline with exact metadata and prompt omitted by existing privacy preference |
| M2 AI Remove / M5b Upscale | Real native inference and Accept; source exact; upscale dimensions 4× |
| Maximum 1024² canvas / 786,432 exterior pixels | Real native generation/Accept; zero changed original bytes; one candidate |
| Reopened grouped PSD expanded again in final build | Direct Image/dialog/Generate/Accept; exact source/composite; normal raster result; offline Undo/Redo 8/13 ms |
| Final offline reopen | **28 native PSD/PSB files passed in final rebuilt app**, including groups/masks/guides, transparency, maximum size and M6/M7 regression. Backend stopped; instrumented counters: 0 Comfy commands, 0 backend HTTP requests |

The final build includes the reopened-group gate correction and a scrollable dialog for constrained height. Rendered dialog, preview boundary, accepted exterior and group/mask layer stack were visually inspected at 1440×900. A window-resize attempt did not resize the native window, so there is no claim of a verified 960×600 layout. Direct versus instrumented checks are intentionally distinguished above.

Two initial offline comparison failures were investigated, not suppressed: empty group markers serialize from a four-byte placeholder to zero bytes (no raster content), and M7 deliberately strips prompts under its default privacy preference. Raster/mask bytes, bounds and composites matched. The gate now admits both empty group representations, with two regression tests proving reopened groups can expand again. The offline comparator normalizes only proven-empty group markers and compares the M7 recipe after the configured prompt omission. Raw diagnostic and successful subsequent receipts remain in [native receipts](native-receipts.json).

## Performance and memory

These are observations on this host, not latency guarantees. [Summary](performance-summary.json) keeps machine-readable ranges.

| Stage | Observation |
| --- | --- |
| Production Rust corpus transport | 13.047–18.115 s; median 13.344 s |
| Off-document geometry/source/input preparation (16 corpus cases, JS diagnostic) | 7.97–14.38 ms |
| Crop and containment (same diagnostic) | 1.27–5.62 ms |
| Accept / Undo / Redo (same diagnostic) | 12.88–29.05 / 1.80–5.19 / 3.99–9.18 ms |
| Native right-side preparation / preview / Accept | 31 / 4 / 43 ms |
| Final native reopened-group preparation / preview / Accept | 47 / 2 / 41 ms |
| Maximum native queued-to-preview | 142.9 s |
| Maximum native preparation / preview / Accept | 73 / 71 / 213 ms |
| Final native grouped Undo / Redo, backend stopped | 8 / 13 ms |

Two separate warm runs of the identical fixed graph were profiled with diagnostic Python/WebSocket instrumentation, **not measured as production transport phases**. Encoding took 5.31–25.94 ms, upload 2.39–3.08 ms, submission-to-execution-start 2.63–3.11 ms, sampler 11.42–11.51 s, VAE decode 0.53–0.56 s, download 0.88–0.98 ms and local PNG decode 1.66–2.31 ms. Total graph execution was 12.73–12.87 s. These diagnostic phase timings and node events are in [profile.json](profile.json); the production corpus totals above are separate evidence.

One-Hz RSS sampling observed PhotoSuite host peaks of **172.8 MiB**, the editor WebContent process **609.6 MiB**, and owned ComfyUI processes **3,081.8 MiB**. WebContent attribution is based on launch time; inspector processes are separate. RSS does not isolate unified GPU allocation, and these are observed peaks, not process-memory caps. Candidate and preview buffers are each capped at 4 MiB; conservative retained session pixel accounting is 42 MiB plus explicitly separate transport/acceptance/history/cache allocations. [Raw process summary](memory-summary.json) records the measurement limits.

## Files, compatibility, packaging and boundaries

PSD/PSB store ordinary raster layers; reopening needs no backend. The final native 28-file pass verified dimensions, all layer/mask pixels and placement, guides and editor recomposition. Existing PSD white-matted composite storage for transparent documents remains unchanged. No claim is made that stored white-matted RGB equals unmatted RGBA; exact appearance is verified from reopened layers.

Independent **psd-tools 1.21.0** verified 32 corpus files and 28 native files: dimensions, ordinary pixel-layer kind, result bounds and exact generated RGBA hashes. [Corpus parser receipts](independent-psd-tools.json), [native parser receipts](independent-native.json). No claim that another editor understands generation recipes.

The debug bundle grew from 279,299,878 to 279,322,454 bytes: **+22,576 bytes**, with no new dependency, runtime or model. This compares local development app bundles; no public release artifact was made. PhotoSuite/ComfyUI and checkpoint licensing remain as reviewed in [M6 provenance](../m6/README.md).

External full evidence: `/Users/joe/Documents/Codex/2026-09-28/photosuite-m8-acceptance/`. It includes source/input/mask/raw/final images, `.bin` files, model/geometry hashes, real backend logs, native harness and events, timings, and retained native PSD/PSB fixtures. Native files were saved through `/tmp/photosuite-m8-fixtures/` and copied into `native-files/` in that evidence directory. The owned ComfyUI instance was stopped at completion. No unrelated unsaved-close fix, M5a work, artboard support, infinite canvas, composition intelligence, cloud generation, or release work was started.
