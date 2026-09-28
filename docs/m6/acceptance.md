# M6 acceptance — 2026-09-28

Evidence lanes are separate below. This is local macOS evidence, not hosted CI, cross-platform release or public-package evidence. Machine: Apple M5,16GiB unified memory, macOS27; user-managed ComfyUI0.37.4, Python3.13.12, PyTorch2.12.1/MPS, reviewed SD1.5 inpainting hash from [setup](README.md).

## Automated and real-backend lanes

- `npm test`:2,041 passing,0 failures/skips. M6 adds18 deterministic JS cases.
- `npm run lint`, `npm run verify`, `git diff --check`:pass.
- `cargo test`:24 passing,2 opt-in live tests ignored; ordinary CI requires no model.
- `cargo check` and rustfmt checks on modified Comfy modules:pass. Existing unrelated `lib.rs` formatting not rewritten.
- Production Rust opt-in M6 corpus:17/17 executions,263.70s runner total; receipts have each UUID, seed, dimensions, bytes and time.
- Actual JS editor adapter/M0 composition:17/17 zero unauthorized changed bytes, source hashes preserved. [Containment receipts](containment-receipts.json), [quality interpretation](quality.md).
- Native debug bundle build:pass. Final rebuilt app repeated actual generation/Accept with exact source/containment, then offline Undo/Redo and seven PSD reopens. No push/hosted CI/release performed.

The fake-service matrix validates contracts and failure handling; it is not model-quality evidence. Actual model results were visually reviewed in the retained comparison images.

## Native matrix

The actual bundled Tauri application was controlled through macOS accessibility. Its Web Inspector executed an external, guarded acceptance harness using the real app controller, provider, Rust bridge, history, PSD serializer and file loader. It did not replace inference, transactions or result bytes. Exact hashes and receipts are [retained here](native-receipts.json).

| Requirement | Method and observed result |
| --- | --- |
| Backend stopped launch / unavailable setup | Launched actual bundle with listener stopped. Direct Edit → Generative Fill → Check backend reported unavailable, Generate disabled, source pixels/history unchanged by that operation. |
| Selection | Harness applied exact fixture selection through M0; direct rectangle selection move and direct Undo also exercised. The move was undone before generation. |
| Prompt/preflight/Run | Direct Edit menu/dialog, typed prompt and seed42, checked readiness0.37.4, clicked Generate. |
| Visible progress / responsive editor | Native strip showed Preparing/Generating. Direct Info button opened its panel while inference ran. |
| Real Cancel / no preview or commit | Direct Cancel while Generating; authority/session immediately removed, source one layer/history index unchanged. Targeted backend cancellation settled; no late preview. |
| Rerun / Discard | Instrumented production submission; visibly inspected contained native preview; direct Discard. Exact before/after source/composite/history snapshots equal. |
| Three variations | Instrumented submission with count3; sequential native jobs. Direct A/B/C inspected visibly different mugs; hashes/seeds42,43,44 distinct. No preview history. |
| Chosen Accept | Direct A then Accept. One M0 transaction; source unchanged; exact ROI91,0,393,384; chosen patch hash exact;0 outside-selection changed bytes; unused candidates/session released. |
| Undo / stop backend / Redo | Direct Edit Step Backward; byte-exact source restored. Owned backend process terminated and connection refused verified. Direct Step Forward restored exact accepted pixels. |
| Offline PSD save / close / reopen | Native serializer/write and actual file loader instrumented with backend stopped. Source/result/rect/composite hashes exact; no recipe resumed; prompt absent. |
| Empty prompt / transparent / edge / soft | Native production submission+Accept on each fixture; exact source preservation, one transaction and0 changed bytes outside selection; each PSD saved. |
| Source edit while generating | Harness changed a source byte at real Generating stage. Native M1 became stale; no preview/history commit. |
| Selection edit while generating | Harness changed coverage at real Generating stage. Native M1 became stale; no preview/history commit. |
| Tab switching / no redirect | Other real document remained current. Source alone owned overlay; other snapshot exact. |
| Document close / no late mutation | Actual tab detach while Generating. Job cancelled, source removed, session/overlay gone; late result never committed. |
| Regenerate valid | Production Regenerate(true), old result discarded, same seed recorded, source unchanged. |
| Regenerate stale | Changed selection, then immediate Regenerate call rejected and removed authority. |
| M2 compatibility | Real AI Remove production submission+Accept succeeded; source preserved and outside0. Fixed graph contract separately tested unchanged. |
| M5b compatibility | Real independent Real-ESRGAN native workflow produced2400×1600 output in a new document; source snapshot unchanged. |
| Maximum bounds | Three sequential1024² candidates through native provider, then candidateB Accept, exact containment/source and saved PSD. See measurements below. |

Native preview A hash: `8097aaae5dd0db429a97a7503c91e7c60aa1b20cac5d33163198955d115e9938`.
Accepted source hash: `2c9022e5a85bd6baa1679a11f91fa94fd1d69ba879414f5da7c55066ea3b28fc`.
Accepted and offline-reopened composite: `a0cc7f9d04428b70f71eec209ede94be9a82e25454d256c683fc451e47c6bceb`.
PSD size:1,664,491 bytes.

The final rebuilt app (fresh process) reproduced the same cup source/patch/composite hashes, with preparation19ms, containment/publication1ms and Accept4ms. With ComfyUI stopped again, native instrumentation verified offline Undo/Redo and exact source/result/geometry/composite for seven saved PSDs: direct-UI cup, context-free, transparent, canvas-edge, soft,1024² limit, and final-build cup. All seven passed. Test documents were closed and desktop visibility restored afterward.

The pre-Accept history retained an undone selection-move branch (length3,index1). Accept replaced that redo branch, yielding length3,index2: exactly one new applied transaction, not an extra hidden preview entry.

Testing notes: WebKit paused rendering when the app was occluded; native Hide Others made the editor visible and restored normal painting, with no product workaround. Inspector eager evaluation initially repeated unguarded measurement expressions; the authoritative capture and subsequent scripts use one-shot guards. Those diagnostic duplicate/cyclic-serialization records are excluded from the summarized receipts, while the raw external log is retained. Neither issue was treated as a model/product pass or an excuse to skip acceptance.

## Timing and memory

Native ordinary three-candidate preparation21ms, containment plus preview publication2–3ms per candidate, freshness plus switch5ms, Accept9ms. These are millisecond-resolution observations, not percentiles. Corpus adapter containment/publication has its own Node-runtime timings in the receipts; it does not measure native canvas rasterization. The preview canvas is created lazily by the existing renderer.

Maximum native run: 3 × 1,024² × 4 bytes = **12 MiB retained result pixels**. Queued-to-preview times:152.417s,162.700s,145.649s; total session461.408s. Preparation103ms, containment/publication3–5ms, switching6ms, Accept35ms. Accepted source exact and outside-selection changed bytes0. This measured slow case supports a hard upper bound, not a recommended image size or performance guarantee.

Separate diagnostic of the exact fixed graph on the same backend/checkpoint (Python Pillow encode/decode plus ComfyUI websocket node events; **not instrumented Rust subphase timings**):

| Phase | Fresh backend process | Warm process |
| --- | ---: | ---: |
| RGB/mask conversion + PNG encode |30.37ms|45.75ms|
| Both PNG uploads |2.99ms|9.70ms|
| Submission to execution start |2.12ms|4.34ms|
| CheckpointLoaderSimple node |2,600.11ms|cached|
| Inpaint conditioning / VAE encode |858.45ms|843.85ms|
| KSampler inference |13,093.27ms|11,865.07ms|
| VAE decode node |963.14ms|539.87ms|
| SaveImage to execution success |175.21ms|16.85ms|
| Result PNG download |2.40ms|0.70ms|
| PNG decode to RGBA (Pillow) |18.40ms|3.22ms|

Node durations use consecutive `executing` events and include that node's backend work/overhead. Model loading onto devices may also occur in downstream nodes. Fresh process does not imply a cold filesystem cache. [Retained node events](phase-profile.json). Typical actual production Rust corpus totals were13–18s, with the600×512 case25.845s; these totals include preflight, encoding, HTTP, polling, inference and decoding. Diagnostic phases do not add up to a separate measured Rust total.

Observed1Hz RSS maxima during the maximum run: PhotoSuite host169.91MiB; the WebContent process that appeared with this app1,061.77MiB; ComfyUI4,430.06MiB. Across the broader native session the host reached178.02MiB. Attribution of WebContent is by process-launch timing (macOS reparents it to PID1), not an isolated renderer allocator measurement. Samples include Inspector/harness, previously opened images, M5b output and editor/history allocations. They do not equal the bounded12MiB candidate result storage. [Memory summary](memory-summary.json) retains process IDs/ranges/sample counts.

ComfyUI MPS reported16GiB unified total and free memory1.39–8.51GiB during the maximum run. This is shared system/device accounting, not isolated GPU peak; no precise isolated GPU-memory claim is available. RSS does not include every unified-memory allocation. Numbers are observations on one machine with other activity, not universal performance guarantees.

Comparable macOS debug bundles: accepted M5b272,428KiB → final M6 **272,784KiB**, **+356KiB (~0.13%)**. The rebuilt app is266.38MiB. Final build used `npm run build -- --debug --bundles app --no-sign`; this is unsigned local validation, not a signed/notarized release. No model, Python, ComfyUI or new inference runtime was bundled.

## Reproduction and retained evidence

Repository workflow:

```sh
python scripts/m6/create-corpus.py /absolute/external/evidence/corpus
node scripts/m6/prepare-corpus.mjs /absolute/external/evidence/corpus
PHOTOSUITE_GENERATIVE_CORPUS=/absolute/external/evidence/corpus cargo test --manifest-path src-tauri/Cargo.toml real_generative_corpus -- --ignored --nocapture
node scripts/m6/contain-corpus.mjs /absolute/external/evidence/corpus
python scripts/m6/render-corpus.py /absolute/external/evidence/corpus
```

Use the reviewed backend/checkpoint and a Python environment with Pillow. Normal tests do not run these commands. The native harness invokes existing app methods from the actual Web Inspector; direct UI steps must also be repeated rather than substituted with a browser-only run.

Local acceptance evidence: `/Users/joe/Documents/Codex/2026-09-28/photosuite-m6-acceptance/`. It contains raw/model/contained buffers and PNGs, source selections, comparison sheets, backend logs, UUID/seed receipts, native-event log, PSDs, memory samples and diagnostic harnesses. These are fixture prompts and images. User-managed backend input/output/history remains outside PhotoSuite's ownership; acceptance does not delete it.
