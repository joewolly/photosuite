# M3 acceptance — 2026-09-28

Verdict: **PASS WITH NOTES** for the bounded local M3 capability. Notes are the
small correlated corpus, fine-edge/alpha limitations, substantial runtime memory,
macOS-only native execution, and the precise network-denial boundary below.

Starting state was clean `codex/m2-local-inpaint` at
`c1fc3179ebf78b8e9d5d5d4b2e063b4ca637dce8`. Work is on
`codex/m3-subject-selection`, directly based on that commit. M0/M1/M2 history and
transaction implementations were not rewritten. The implementation commit is the
commit introducing this report (obtain its immutable SHA with `git log -- docs/m3/acceptance.md`).
No push, merge, tag, release, deployment or M4+ work was performed.

## Automated and artifact evidence

- `npm test`: **1918 passed**, 422 suites, 0 failed/skipped (47 added M3 cases).
- `npm run lint`, `npm run verify`, `git diff --check`: passed.
- Native macOS debug app build: passed, **209.96 MiB**. No Rust source changes.
- The committed conversion recipe was rerun from the pinned official source and
  reproduced SHA-256 **79bc52b86f15cf146646e2e82ee9a6589151e4d28db4c190c9dd98c3a3a7344c** exactly.
- 11 actual-model WASM quality cases, contact sheets, individual model masks and
  synthetic-label metrics are retained in [evidence](evidence/).

Tests cover portrait/landscape/odd/tiny/offset geometry, opaque RGB represented
as RGBA, partial/zero alpha, padding, normalization, bilinear soft reconstruction,
canvas containment, malformed dimensions/NaNs, identity/mapping validation,
success/preview/Accept/Discard, cancellation, source/target/selection changes,
late/duplicate/repeated requests, close/tab safety, exact Undo/Redo, source-byte
preservation, existing raster-mask intersection, vector coexistence, PSD roundtrip,
manual removal compatibility, worker failures/restart, and packaged asset hashes.
Ordinary tests do not pretend to run the real model.

Model plus runtime and notices add **105,994,702 raw bytes (~101.08 MiB)**. Tauri's
existing `frontendDist: ../src` embeds these assets in the executable; the worker
resolves all assets with module-relative URLs. The native build loaded them from
`tauri://localhost`, including the model hash check. There are no new OS-specific
paths, Python requirements, Cargo dependencies, or packaging scripts. Windows and
Linux use the same bundled WASM route, but their native builds/execution were **not
tested** in this acceptance. No signed, notarized, released or hosted-CI claim.

## Native Tauri evidence

Machine: Apple M5, 16 GiB RAM, macOS 27.0 (26A428). Native debug build, Web Inspector
open during instrumentation. UI actions used native menus/buttons and brush
gestures. Temporary inspector code observed the real controller/job service,
hashed actual buffers and drove its production methods for repeated lifecycle
cases. No model, provider, history or result was mocked. The observer is not
shipped. A loopback receiver recorded [native-events.jsonl](evidence/native-events.jsonl);
it served **no model or inference**. Native PSD files and raw object/clutter/fur
masks are also retained locally in
`/Users/joe/Documents/Codex/2026-09-28/photosuite-m3-acceptance/`.

| Required native behavior | Observed result |
|---|---|
| Launch and local file open | Passed in ordinary and request-denied builds |
| Ordinary editing | Native brush stroke adds history; native Step Backward restores it, including under request denial |
| Person Select Subject | Native Select menu starts real model; transient subject/helmet preview appears |
| Discard | No selection, mask, pixel or history change; clean repeated proof starts at history 1/index 0 |
| Rerun/Accept | One selection entry: history 1→2, index 0→1 |
| Selection Undo/Redo | Exact stored selection hash; job count unchanged |
| Automatic Remove Background | Native Layer menu starts same job; Accept creates a separate raster mask; source hash unchanged |
| Mask Undo/Redo | Exact mask and rendered composite restore; no inference |
| PSD save, close and reopen | Production PSD serializer/native writer, close-tab handler, native file loader; source/mask/composite hashes exact |
| Non-person/clutter/hair-fur | Actual native runs on coffee, odd coffee crop and cat; masks retained; person includes hair |
| Cancel during inference | Cancelled, Accept revoked, history unchanged, input/result released |
| Modify source during inference | Stale; Accept refused; history unchanged; test byte restored |
| Tab switch | Preview remains on source cat document while object tab is active; active object has no preview |
| Close during inference | Document removed; job cancelled; after 4.5 seconds no late overlay/history change |

The native app visually rendered the reopened person and cup/saucer cutouts with
checkerboard transparency and separate mask thumbnails. PSD evidence compares
`getRasterData()` (which synchronizes the GPU composite), not a stale CPU buffer.
The earlier `psd-composite` raw record used the unsynchronized CPU buffer and is
invalid for composite comparison; the later `offline-psd-exact` and
`denied-worker-psd-exact` records supersede it with all three comparisons true.
An early UI focus mistake created a temporary opacity history entry; it was undone.
The later clean offline sequence independently proves the one-entry/discard gate.

## Offline boundary and verification

Production M3 only imports/fetches bundled local assets and has no service fallback.
Comfy Desktop happened to be running on this machine; that does not establish M3
independence. The explicit request-denial test below establishes that boundary.

We did **not** disconnect the host's network interfaces. First, a process
`sandbox-exec` attempt failed as an isolation method: WebKit's separate networking
service could still fetch an external URL. The raw `offline-network-probe` with
`externalAvailable: true` is retained and **does not count as offline evidence**.
An App Sandbox copy then failed during OS sandbox initialization; it is not a
product-build failure or a pass.

The successful acceptance uses a separate native Tauri build with the retained
[test-only CSP configuration](evidence/offline-test-config.json): external requests
and ComfyUI ports are denied; only local Tauri assets/IPC and the evidence receiver
at 127.0.0.1:18768 are allowed. Startup and document open succeed before any model
load. An external no-CORS/no-cache webview probe fails with CSP refusal.

Tauri does not attach that CSP to its JavaScript worker response (`csp: null` in
the raw record). To test the actual inference realm, a temporary inspector Worker
constructor creates a **module Blob worker** that inherits the page CSP and
statically imports the **unchanged production `subject-worker.js`**. It also makes
an external probe from that same realm. The native actual-worker probe returns
`TypeError: Load failed` with CSP refusal, then the production model completes.
No fetch, tensor, model result or inference implementation is replaced. This
isolates the M3 webview/worker request boundary; it is not an OS-wide firewall test
or proof that unrelated Rust networking is disabled. Neither CSP nor the worker
constructor test hook is part of the shipped application.

Under that enforced worker denial, the coffee fixture completed cold Select
Subject, Accept, selection Undo/Redo, warm automatic Remove Background, mask
Undo/Redo, PSD save, close, and native reopen. Pixel/mask/rendered-composite hashes
were all equal after reopen. The independent person sequence also passed with
page-level denial. This proves M3's local workflow without its inference realm
being able to contact external services. The normal packaged worker path was
separately exercised in the ordinary native runs above.

## Native timings (milliseconds)

These are observations on this one debug/inspector machine, not performance promises.
Input preparation includes M1 input/snapshot capture. Preview time is adapter
publication, not time until display scanout. Cold load includes local model read,
hash verification, WASM import/initialization and session creation. Warm load is 0.

| Case | Source | Prepare input | Preprocess | Cold load | Inference | Reconstruct | Publish | Accept |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Person, first preview | 512×512 | 2 | 28 | 3179 | 3700 | 13 | 1 | — |
| Person, warm selection | 512×512 | 0 | 334 | 0 | 3759 | 146 | 3 | 6 |
| Person, warm mask | 512×512 | 0 | 311 | 0 | 3763 | 143 | 3 | 22 |
| Coffee, cold | 600×400 | 1 | 34 | 3434 | 3754 | 37 | 2 | discarded |
| Clutter, warm | 590×395 | 0 | 157 | 0 | 3712 | 91 | 1 | discarded |
| Cat/fur, warm | 451×300 | 1 | 42 | 0 | 3684 | 11 | 10 | discarded |
| Coffee, worker network denied | 600×400 | 1 | 49 | 4305 | 4520 | 44 | 5 | recorded separately |
| Coffee mask, worker network denied | 600×400 | 1 | 173 | 0 | 4386 | 112 | 4 | 25 |

All use 512×512 model input. Native requestAnimationFrame probes continued during
object/clutter/fur inference: 441/241/227 frames; maximum observed gaps 59/33/58 ms.
This shows the editor event/render loop continuing, not a zero-jank guarantee.
Memory observations and strict input bounds are documented in [README.md](README.md).

## Completion report index

| Requested item | Result/location |
|---|---|
| 1. Starting branch/SHA | `codex/m2-local-inpaint`, `c1fc3179ebf78b8e9d5d5d4b2e063b4ca637dce8` |
| 2–3. Final branch/SHA and commits | `codex/m3-subject-selection`; implementation commit introducing this report; final reply records exact SHA |
| 4. Files | Four `subject-*.js` modules; M1 bridge, event/menu/dispatch wiring; vendor model/runtime/notices; four test files; versioned fixtures; conversion/evaluation scripts; M3 docs/evidence |
| 5–8. Model/runtime/decision | BiRefNet-lite, official MIT weights; one ONNX Runtime Web WASM worker; provenance JSON and README |
| 9–10. Input/output | Copied RGBA8, neutral-alpha bilinear 512 letterbox; soft coverage8, explicit transform/identity/settings |
| 11–13. Workflows | Preview then M0 Accept; non-destructive mask; existing manual path retained |
| 14–15. Lifecycle/bounds | M1 cancellation/revisions/freshness; 4 MP input and 512 tensor; README |
| 16–17. Quality/baselines | 11-case corpus, visual review, two synthetic labels, production small/broad Quick Select dabs; no aggregate score |
| 18–19. Tests/validation | 47 new deterministic tests, total 1918 passed; lint/verify/diff/native build green |
| 20–21. Native/performance | Native matrix and measured timings above; actual model, no mocks |
| 22. Packaging/offline | Embedded assets work in macOS bundle; webview/actual-worker request denial verified; OS interfaces remained enabled |
| 23. PSD/Undo/Redo | Exact source, raster mask and synchronized rendered composite; history replay does not invoke provider |
| 24. License/provenance | Independent official weight MIT declaration; complete source/runtime/artifact pins and notices |
| 25. Limitations/deviations | Fine edges, alpha attenuation, selected source limits, memory cost, small corpus, macOS-only execution; test-boundary caveats above |
| 26. Scope | No M4+ work, no M0/M1/M2 rewrite, no service/model-manager framework |
| 27. Verdict | **PASS WITH NOTES** within these explicit evidence boundaries |
