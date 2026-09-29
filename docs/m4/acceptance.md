# M4 acceptance — 2026-09-28

**PASS WITH NOTES.** Actual packaged macOS Tauri inference supports point/box
selection, repeated corrections using an immutable embedding, transient previews,
and one final M0 selection transaction. Quality is prompt-dependent and runtime
memory is substantial. No Windows/Linux execution or production release is claimed.

## Evidence boundaries

Host: Apple M5, 16 GiB RAM, macOS 27.0 (26A428), debug Tauri/WKWebView,
ORT Web 1.22.0 single-thread WASM. Production model/provider/worker code ran in the
packaged app. UI clicks/drag/dropdown and Accept/Discard were exercised directly.
The larger corpus and lifecycle suite used the native inspector to call existing
editor entry points, observe state, and save masks/hashes. Those are native
integration tests, not claims that every row was exercised by physical UI input.
Test-only scripts are retained under `evidence/test-*`; none are product hooks.

Evidence: [native events](evidence/native-events.jsonl),
[Node measurements](evidence/node-measurements.json),
[quality and mask galleries](quality.md), and [model provenance](model-evaluation.json).
The 102-event record includes unsuccessful harness attempts as well as completed
runs. Early console live evaluation invoked a test more than once and cancelled
its own sessions; later guarded single runs completed. Native automation also
returned stale or mismatched accessibility/focus state after restarts with two
copies sharing a bundle identifier. A final supplementary brush smoke attempt is
**inconclusive**, not counted as a pass. Ordinary offline editing evidence is the
existing manual mask operation and its Undo/Redo below; no broad brush QA claim.

## Native acceptance matrix

`UI` means actual native UI actions; `native` means instrumented actual packaged
editor with real model; `deterministic` means simulated provider/event delivery.

| # | Required check | Result / evidence |
|---|---|---|
| 1 | Launch offline | Native request-denied package launched; page and actual model-worker external probes denied. |
| 2 | Ordinary editing | Native manual Remove Background mask edit, Undo/Redo, local file save/open work under denial. Supplementary brush smoke inconclusive as noted above. |
| 3 | M3 Select Subject | Actual existing M3 worker/model produced preview under denial, then Discard; no selection/history mutation. |
| 4 | Invoke Object Selection | UI W tool, opt-in AI checkbox; Classical remains default. |
| 5 | Positive click | UI cup click; native eleven-fixture initial prompts. |
| 6 | Preview | Visible transient coverage; source/selection/history hashes checked. |
| 7 | Correction | UI positive/negative and native accumulated point/box sequences. |
| 8 | New mask replaces old | Native latest revision published with changed mask and same session. |
| 9 | No history yet | Every one of 44 corpus previews checked source/history/selection invariant. |
| 10 | Discard | UI and native. |
| 11 | Prior state unchanged | Native hash/history comparison; deterministic pre-existing selection case. |
| 12 | Rerun | UI after Discard; native new session. |
| 13 | Box | Actual native drag plus eleven native box sequences. |
| 14 | Positive correction | UI cup; separate real native bottle cap coverage 0→254 without any box. |
| 15 | Negative correction | UI Exclude click on spoon, coverage 51→13 versus box/positive result; cup interior remained selected (192→184). |
| 16 | Accept | UI and native existing M0 commit. |
| 17 | One history entry | Native Open history length 1→2, labelled Object Selection. |
| 18 | Undo | Native prior selection restored exactly. |
| 19 | Redo | Native accepted selection restored byte-exact without inference. |
| 20 | Manual Remove Background | Existing command consumes accepted selection. |
| 21 | Source preserved | Full source-byte SHA-256 unchanged. |
| 22 | Mask created | Existing M0 mask transaction, history length 2→3. |
| 23 | Save PSD | Real native filesystem write, 108,654-byte PSD. |
| 24 | Close/reopen offline | Actual editor panel close and file-loader/native filesystem reopen under denial. |
| 25 | Mask/composite exact | Full mask/source/rendered-composite hashes match before and after reopen. |
| 26 | Cancel encoder | Cancel on actual Encoding image progress; worker terminated, no accepted result/history. |
| 27 | Cancel decoder | Cancel on actual Selecting object progress for warm correction. |
| 28 | Source edit → stale | Native one-byte source edit injected, M1 revalidate rejects; byte restored. This was not a brush gesture. |
| 29 | Switch tabs | Real native source→other document while running; preview stayed with source, return correct. |
| 30 | Close source | Actual native panel close during pending work; no late result/history. |
| 31 | Rapid/out-of-order | Real native A cancelled and B published. Forced B-before-A and duplicate completion tested deterministically, not forced in native WASM. |
| 32 | Failure/recovery | Real module worker deliberately throws; production onerror gives actionable failure; subsequent real model retry succeeds. Missing/corrupt artifacts and runtime-start failures simulated deterministically. |

Refine Edge was opened through the native UI after Accept and consumed the
ordinary selection for its preview. Its adjusted output was not separately
accepted and round-tripped in this milestone. Existing classical graph-cut code
is preserved; switching AI off resets its session. Its availability is covered by
integration/code and deterministic gesture tests, not a new exhaustive native
classical quality benchmark.

## Exact transaction and PSD evidence

Both regular and request-denied native runs passed. Accepted selection and
subsequent mask coverage SHA-256:
`38c832498f5d62f66e4abc6f35dbacde1dba797e3a27a4e3358638c66ced4e61`.
Source SHA-256 before/after:
`17ffbfc3e70e06f7bc7c79cd0ba447922e4ce791efac8461b2392545844a1733`.
Rendered composite SHA-256 before/save/reopen:
`0cf929004d7e3a3adaf8373b661f10f1acee5bc072d8c61cf2ccce092f308ff9`.
Local PSD: `/Users/joe/Documents/Codex/2026-09-28/photosuite-m4-acceptance/prompted-mask.psd`.
Undo/Redo restore stored bytes, not a new model run.

## Native timing and memory

Regular native corpus: eleven cold first-image runs and 33 subsequent corrections.
All 33 corrections reused the 16 MiB embedding; warm model load was zero.

| Stage | Observed ms | Median ms |
|---|---:|---:|
| Cold model load | 1682–1769 | 1703 |
| Preprocess | 181–851 | 202 |
| Image encoder | 6079–9243 | 6150 |
| First decoder | 95–146 | 96 |
| Warm correction decoder | 91–154 | 94 |
| Warm reconstruction | 5–45 | 11 |
| Warm publication | 0–3 | 1 |

First reconstruction was 9–33 ms and publication 0–4 ms. These are measured
compute/publication stages, not a display-to-photon latency guarantee. The normal
first result was about eight seconds; subsequent compute was about 106 ms at the
medians. Later inspector/background offline runs varied: encoder samples 6303 and
23224 ms, decoder up to 372 ms; a separate positive-only correction was 441 ms
plus 62 ms reconstruction and 15 ms publication. Do not hide these slower samples.
Corrections remain substantially faster than encoding, but responsiveness varies
with background scheduling and memory pressure.

Process RSS sampled every 0.5 seconds (MiB = 1024² bytes):

| Measurement | Observation |
|---|---|
| M4-only WebContent before model | 322–328 MiB |
| First sampled active M4 RSS | 1363 MiB |
| M4-only peak | 2107.484 MiB |
| About 40 seconds after Discard | 2107.328 MiB, no immediate RSS return |
| Mixed M3/M4 lifecycle stress WebContent peak | 2220.42 MiB |
| Separate native host / inspector stress peaks | About 420 / 197 MiB |

Raw [baseline](evidence/memory-m4-baseline.jsonl),
[active/retained](evidence/memory-m4-active.jsonl), and
[stress](evidence/memory-stress.jsonl) samples are retained. These processes include
editor, WebKit, inspector effects, source/results, model and allocator memory;
they are not isolated model allocation measurements. The short decoder's working
arena cannot be separately resolved by 0.5-second RSS sampling. The known decoder
output is 1 MiB, image input tensor 12 MiB, and retained embedding **exactly 16 MiB**.
A maximum RGBA input copy is 16 MiB; M1/editor also own copies/results. Do not equate
these bounds with a hard cap on ORT or total process memory.

Session termination/close logically releases cache ownership and terminates its
worker, but WebKit/WASM retained allocated pages in the observed M4-only run.
Process exit releases OS resources. This is a memory-intensive optional mode,
not a low-memory feature. One embedding/worker, 120-second maximum embedding age,
30-second worker idle expiry, 4MP layer/canvas bounds and explicit termination
avoid an unbounded cache; they do not promise immediate RSS reduction.

## Offline and packaging proof

The final production code also ran in a test-only package using
[offline-test-config.json](evidence/offline-test-config.json). CSP denies external
page requests. WKWebView module workers did not automatically inherit that policy,
so a test-only Blob module statically imports the unchanged production worker and
inherits the page CSP. A fetch probe from that **same actual model-worker realm**
failed with `TypeError: Load failed` and a CSP refusal. Real inference still loaded
packaged ONNX/WASM bytes. Both M3 and M4 ran through this denial arrangement.

Local Tauri origin/IPC and `127.0.0.1:8767` evidence collection remain permitted.
No OS interface was disabled, no claim of an OS-wide air gap or denial of Rust
networking is made. No fetch, model tensor or inference result was faked. The
product M4 code fetches only packaged model/runtime assets; no cloud or ComfyUI
fallback exists. Undo/Redo and PSD reopen passed with the same denial policy.

Normal debug `.app`: **265.64 MiB**, accepted M3 baseline **209.96 MiB**, increase
**55.68 MiB** (bundle compression differs from raw weights). Offline test app:
265.67 MiB. Builds were unsigned debug acceptance artifacts, not a release.
Encoder 55,015,529 bytes + decoder 8,681,263 bytes = **60.746 MiB raw**.
Existing ORT assets are about 11.08 MiB and are reused without another copy.

Packaged logical paths are `/vendor/prompted-model/encoder.onnx`,
`/vendor/prompted-model/decoder.onnx`, `/vendor/onnxruntime/ort.wasm.min.mjs` and its
existing colocated WASM. Tauri embeds frontend assets; these are WebView asset
URLs, not loose files required beside the executable. Relative ES-module URL
resolution is expected to work through the platform Tauri origin on Windows/Linux,
but neither was built or run here. Hash/size verification precedes every new model
session. Bundled artifact hash tests independently verify provenance agreement.

## Automated validation and repository scope

- `npm test`: **1989 tests, 422 suites, 0 failures/skips** (71 new tests over M3).
- `npm run lint`: pass.
- `npm run verify`: pass (all repository verification scripts).
- `git diff --check` and staged equivalent: pass at commit preparation.
- `PATH=/Users/joe/.cargo/bin:$PATH npm run build -- --debug --bundles app --no-sign`: pass.
- Final request-denied native build: pass; same production source including cache expiry cleanup.
- No Rust source changed; no claim of new Rust test coverage.

New source: `prompted-workload.js`, `prompted-worker.js`, `prompted-provider.js`,
`prompted-target.js` in `src/features/modernization`, and
`src/document/tools/prompted-selection-gesture.js`. Small integrations only in
`selection-jobs.js`, `transform-tools.js`, `plugin-tool-overlays.js`, and
`shape-text-tool-options.js`. Added five test files, corpus, conversion/evaluation
scripts, model artifacts/notices and this evidence. M0 transaction, M1 job-service,
M2 provider and M3 model/provider/workload/runtime implementation files are unchanged.

## Completion report index

| # | Requested item | Result |
|---|---|---|
| 1 | Starting branch/SHA | `codex/m3-subject-selection`, `613d60d4ead31f94b7bb7ac6e9b1039d30a6a0e0`, initially clean. |
| 2 | Final branch/SHA | `codex/m4-prompted-object-selection`; SHA is the commit containing this report, returned in the completion message. |
| 3 | Implementation commits | One local M4 implementation/evidence commit directly above accepted M3. |
| 4 | Files | Source/test/model/docs/scripts inventory above and commit diff. |
| 5 | Model | Official SAM 2.1 Hiera Tiny, image-only. |
| 6 | Source/revision/hash/license | Exact code/checkpoint/exporter revisions and all SHA-256 values in model-evaluation.json; Apache-2.0 checkpoint/code, MIT exporter/runtime. |
| 7 | Architecture | Lazy dedicated module worker, encoder + decoder, coverage-only provider. |
| 8 | M3 reuse | Exact existing ORT Web 1.22.0 binary assets; separate workers/model sessions. |
| 9 | Size | +55.68 MiB normal debug bundle; 60.746 MiB raw ONNX. |
| 10 | Encoding | One 1024² square image encode, three projected feature tensors, repeated prompt decoder. |
| 11 | Cache | Full-pixel SHA + geometry/preprocess/model/settings identity and session ownership; one 16 MiB entry, 120s age, 30s worker idle, terminal invalidation. |
| 12 | Prompts | Up to 64 typed positive/negative document-coordinate points, one box; no prior logits required. |
| 13 | Mapping | Existing viewport inverse → document → source-origin subtraction → explicit square scales → logits → source/document coverage; no letterbox. |
| 14 | Session | One app-wide transient M4 session; corrections create no history; Accept invokes existing M0. |
| 15 | Corrections | Accumulate prompts, rerun decoder; useful recovery demonstrated, not guaranteed monotonic. |
| 16 | Ordering | M1 monotonic revisions/job identity; late and duplicate results rejected. |
| 17 | Cancel/stale | Revoke acceptance, terminate worker, clear overlay/cache, preserve prior state; exact source rechecked at Accept. |
| 18 | M3 | Distinct automatic operation; real offline M3 preview and deterministic coexistence pass. |
| 19 | Interoperability | Existing manual Remove Background and Refine Edge consume ordinary accepted selection. |
| 20 | Quality | 11 categories, 55 Node configurations, 44 native accumulated previews; per-case IoU/BF and photographs in quality.md. |
| 21 | Timing | Native stage ranges and slower background/offline observations above. |
| 22 | Memory | Exact 16 MiB embedding; WebContent stress up to 2.2 GiB; no immediate RSS return promise. |
| 23 | Tests | Mapping/DPI/rotation/offsets, source identity/cache/bounds, sessions/ordering, provider failure, M0 exact history/PSD and M3 coexistence. |
| 24 | Validation | 1989 tests, lint, verify, whitespace and macOS native build pass. |
| 25 | Native | 32-row matrix distinguishes UI, native instrumentation and forced deterministic ordering. |
| 26 | Offline/package | Packaged real model under page/worker request denial; local IPC/evidence endpoint permitted; no OS-wide network isolation claim. |
| 27 | PSD/Undo/Redo | Exact source/mask/composite hashes and no reinference; see above. |
| 28 | Licensing | Checkpoint-specific official model card verified before download; reproducible local conversion; notices shipped. |
| 29 | Limitations | Memory, first encode delay, prompt ambiguity, coarse fur/confidence edges, limited corpus, large-image antialias difference, 4MP bound, platform coverage and supplementary UI automation caveats. |
| 30 | Scope | No M5+, video/tracking, matting, generation, model manager, cloud fallback, push, merge, tag or release. |
| 31 | Verdict | **PASS WITH NOTES** for bounded M4 functionality on tested macOS package. |
