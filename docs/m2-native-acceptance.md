# M2 native and real-backend acceptance

**Verdict: PASS WITH NOTES — 2026-09-28.** The actual macOS Tauri application completed the required real ComfyUI generation, cancellation, Discard, M0 Accept, exact offline Undo/Redo, PSD reopen, stale-source and document-close checks. Repository-wide Rust formatting still fails with the **identical formatting diff on the accepted M1 baseline**; no unrelated formatting changes were included. Phase timing and platform limitations are stated below.

## Baseline and delivery

- Starting branch: `codex/m1-job-lifecycle`.
- Starting/accepted M1 SHA: `492b900a27f315c64978b004a6ff516bca5e5dd4`.
- Delivery branch: `codex/m2-local-inpaint`, based directly on that SHA. The M2 commit containing this report is the implementation commit; use `git log -1` on this branch for its immutable SHA.
- Accepted M0/M1 commits were not modified or squashed. No push, merge, tag, release or M3+ work was performed.
- The user explicitly waived Fixer delegation and later explicitly requested assistance installing the missing checkpoint. The one-time acceptance-model download went into their external ComfyUI installation. PhotoSuite contains no downloader or installer.

The architecture, supported setup, graph, endpoint restrictions, limits, retention and troubleshooting are in [m2-local-inpaint.md](m2-local-inpaint.md). A machine-readable record of the actual jobs and byte-comparison assertions is in [m2-acceptance-receipt.json](m2-acceptance-receipt.json).

## Environment and provenance

| Item | Observed value |
| --- | --- |
| Application | PhotoSuite 0.9.14, actual unsigned debug Tauri `.app` |
| Build command | `npm run build -- --debug --bundles app --no-sign` |
| Host | Apple M5, 16 GiB unified memory, macOS 27.0 / 26A428 |
| Desktop manager | Comfy Desktop 1.1.3, installed by the user |
| ComfyUI server | **0.37.4**, Python 3.13.12, PyTorch 2.12.1, MPS |
| Endpoint | `http://127.0.0.1:8188` |
| Supported exact targets | 0.37.0 and 0.37.4; 0.37.4 received real native acceptance |
| Service license | GPL-3.0; separate from model licensing |
| Workflow | Repository-controlled `photosuite-remove-v1`, eight built-in types / nine nodes; no custom nodes required |
| Checkpoint | `sd-v1-5-inpainting.ckpt`, SD 1.5 inpainting with CLIP and VAE |
| Model source | [stable-diffusion-v1-5/stable-diffusion-inpainting](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting), revision `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb` |
| Model license | CreativeML OpenRAIL-M, as recorded in the model card |
| File size | 4,265,437,280 bytes |
| SHA-256 | `c6bbc15e3224e6973459ba78de4998b80b50112b0ae5b5c67113d56b4e366b19` — downloaded bytes matched the repository's LFS SHA |

The model repository describes itself as a community mirror of the former Runway model, not an affiliation with Runway. The checkpoint and provenance are stored outside PhotoSuite at `/Users/joe/ComfyUI-Shared/models/checkpoints/` and `/Users/joe/ComfyUI-Shared/model-provenance/`. PhotoSuite distributes none of ComfyUI, Python, model weights or custom nodes. Its transport and PNG dependencies are ordinary application dependencies, not an inference runtime.

The relevant upstream `server.py`, `nodes.py` and `comfy_execution/jobs.py` were inspected and compared between [0.37.0](https://github.com/Comfy-Org/ComfyUI/tree/v0.37.0) and [0.37.4](https://github.com/Comfy-Org/ComfyUI/tree/v0.37.4); those files were identical. Live preflight exposed SaveImage's actual IMAGE output socket, which was corrected in the implementation and deterministic fixture before final acceptance.

## Native checklist

Actions used the actual Tauri application and native menus/dialogs through CUA. Temporary Web Inspector observers recorded actual M1 events and compared retained native document buffers; they did not replace providers, M0/M1, HTTP or inference. An earlier fake-service exercise is retained separately in raw logs and is not counted as real inference evidence.

| Required checks | Result and evidence |
| --- | --- |
| 1–4: launch/edit/invoke with service unavailable | PASS. App launched and editing remained usable. Missing setup and connection-refused errors appeared without pixels, layers or history being committed. |
| 5–6: configure/test real service | PASS. Enabled the local endpoint and exact checkpoint; Test Connection reported 0.37.4 and the installed model. |
| 7–10: selection, invocation, responsiveness, progress | PASS. Selected the orange object in the fixture. The UI reported Preparing and Generating. Opening the Info panel during inference updated selection dimensions while generation continued. |
| 11–12: real cancellation | PASS. Job `877fad47-8bb3-450c-9e5d-bfeb3161c138` was cancelled during KSampler execution. Accept was unavailable, the preview was absent, source bytes were exact, and the service recorded targeted cancellation. |
| 13–16: rerun, preview, Discard | PASS. Job `ab981e29-c12e-45d0-88aa-ccf1dbcb225d` completed. Preview was transient with one source layer and unchanged history. Discard removed it and released the result. |
| 17–23: rerun, preview, Accept, placement/source/containment/history | PASS. Job `d6346700-790f-4a1a-af71-47d93c984a66` completed. Accept inserted one ordinary AI Remove raster at `(45,15,220,234)`. Source bytes were unchanged, and byte comparison found **zero differences outside the removal selection**. Exactly one AI Remove history transaction advanced the history index from 1 to 2. An existing undone selection-move entry was replaced on the redo branch, so history length remained 3. |
| 24: Undo | PASS. The result layer disappeared. Source and full rendered composite were byte-identical to the original. |
| 25–27: stop backend, Redo | PASS. ComfyUI was stopped using Desktop. A loopback probe recorded connection refused. Redo restored the exact patch, source, placement and composite without inference. |
| 28–31: save, close, reopen PSD offline | PASS. Saved `m2-real-accepted.psd`, closed it and reopened it while ComfyUI remained stopped. Source, ordinary raster bytes, ROI and rendered composite matched the accepted document exactly. No special AI object, recipe or external reference was required. |
| 32–33: mutate source while running | PASS. After restarting ComfyUI, native Edit → Clear changed source pixels during job `056b1bbc-3d34-40a0-878e-aa05d0baee41`. M1 marked it stale, showed “Source changed — rerun”, exposed no Accept and retained no result. The service cancelled that job only. Undo restored the fixture source exactly. |
| 34–35: close while running | PASS. Saved the disposable fixture, started `cf41ab9a-e7f2-49b1-a13e-dae891a7989e`, then closed it during Generating. M1 recorded `document-closed`, cancelled, stopped retaining input/result, and the service cancelled the owned job. After settlement, the retained closed document still had exactly one unchanged source layer and no preview/history mutation. |

The fixture is a 320×256 raster with an orange object on a blue grid/gradient background. The accepted selection was `(109,79,92,106)`. Its clipped 64-pixel context ROI was `(45,15,220,234)`, padded separately to 512×512 for the model. Both a discarded real preview and the accepted preview visibly replaced the object with background-like pixels. This is integration/containment evidence, not a general image-quality benchmark.

The initial attempt to close a modified fixture did not close it: the existing unsaved-close confirmation path returned without a visible dialog in this native automation session. That job finished and was discarded. The final close-during-generation test used a saved fixture and passed through the real close handler. No changes were made to the unrelated confirmation infrastructure.

A final rebuilt-app regression run used a diagnostic setup in the actual native Document: a 93×107 selection at `(110,80)` with 9,952 storage bytes, including one unused byte set to 255. Real job `3e3fc8e3-40f7-4c46-9905-45224c5694a9` reached preview and was accepted through the native Accept button. The source remained exact, layer count changed from one to two, and history from one to two. This confirms the alignment-padding fix in the final native build; no inference or transaction code was stubbed.

## Measured behavior

| Measurement | Observation |
| --- | --- |
| Model transfer | 512×512: binary RGBA + mask = 1,310,720 bytes |
| PNG upload payloads | Source 103,115 bytes + mask 5,579 bytes = **108,694 bytes**, excluding multipart overhead |
| Generated PNG | 144,057 bytes for the first discarded completion; 126,443 bytes for the accepted completion |
| Normalized result | 1,048,576 bytes before removing model padding |
| Retained ROI patch | 205,920 bytes (220×234×4) |
| Queue time | **1 ms** for the recorded discarded run, from service create/start timestamps |
| Service execution | **21.271 s** for that run, including its graph execution |
| Completion → native preview | **210 ms**, combining result polling, transfer, decode, Tauri return, crop/containment and preview publication |
| Accepted run create → preview | **20.946 s**; complete service timing for this run was not captured before the offline restart |
| Accept | **5 ms**, measured around real M1 Accept including validation and M0 commit |
| Sampling | 120 samples across approximately 124 seconds, overlapping the accepted run |
| PhotoSuite host RSS peak | **122.56 MiB**; excludes WebKit subprocesses, so this is not total editor memory |
| ComfyUI Python RSS peak | **968.70 MiB**; excludes unified GPU allocations |
| MPS memory | API reported total 16 GiB and system-wide free unified memory. Minimum free observed was 2.48 GiB; dedicated per-job VRAM allocation was unavailable. |

Receive, decode and preview rendering were not isolated into separate timings. The combined post-completion measurement above includes polling latency and is not a pure decoder benchmark. Concurrent automated tests affected system memory. These measurements describe one small fixture on one machine; they establish no general throughput, quality or RAM guarantee.

Cancellation revoked editor authority immediately. Document-close cancellation settled at the adapter 251 ms after the initial cancellation event in the recorded run. Backend stop acknowledgement alone was not treated as proof of GPU termination; the service's terminal job records supplied that evidence. No global interrupt or queue clearing was used.

## Automated validation

| Command / coverage | Result |
| --- | --- |
| `npm test` | **PASS: 1,871 tests, 422 suites, zero failures** |
| `npm run lint` | PASS |
| `npm run verify` | PASS: imports, bindings, cycles, statics, shadows, prototypes, formats, bootstrap |
| `git diff --check` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml` | **PASS: 20 tests**, including seven new table-driven transport tests; binary/doc-test suites also passed |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS |
| Native debug `.app` build | PASS; used for the acceptance above |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | **Baseline failure.** The complete formatting diff matches accepted M1 exactly after path/line-number normalization. Existing drift is in lib.rs, native_menu.rs, printing, sidebar_plugins.rs and user_resources.rs. The added Comfy modules pass rustfmt independently. |

The 32 new JavaScript cases cover nine edge/corner/interior mappings, odd dimensions, padding, hard inference/soft output masks, source/selection/target/history staleness, bounded binary transport, immediate and late cancellation, close/tab authority, malformed output, retry, single retained preview, actual M1 → M0 Accept/Undo/Redo and real PSD serialization/reopen. The inference-field native shortcut and odd selection alignment-padding regressions are covered too. Selection freshness compares only pixels inside the selection rectangle; unused storage bytes have no authority. Existing M1 tests cover repeated/late completion and job terminal-state authority.

Seven new Rust tests contain table-driven cases for both supported versions; missing/malformed capabilities/model; redirects; timeout and response limits; upload identity and mask polarity; submission/rejection; matching and foreign jobs/workflows/outputs; equivalent JSON numeric encodings; missing/wrong-size/malformed images; backend error/restart; targeted cancellation; and lease/resource release. Ordinary CI needs no model or live ComfyUI.

## Scope and retained evidence

Added implementation files: `comfy.rs`, `comfy/tests.rs`, `comfy-provider.js`, `inpaint-config.js`, `inpaint-target.js`, `inpaint-workload.js`, `local-inpaint-settings.js`, and `inpaint.test.js`. Modified integration files: Cargo manifest/lock, Rust registration, settings, UI event/dispatch, preferences and its test, Edit/native menu bridge, overlay renderer, selection-job integration, and the English preference label. Documentation consists of this report, the architecture/setup guide and the JSON receipt.

Full local evidence is preserved at:

`/Users/joe/Documents/Codex/2026-09-28/photosuite-m2-acceptance/`

It contains the accepted PSD, fixture, actual uploaded crop/mask, generated model output, model provenance, real job/capability records, raw and filtered native event logs, performance samples, validation/build logs, baseline formatting comparison and artifact hashes. `requests.jsonl` belongs to the earlier fake-service/evidence collector; it is **not** represented as a wire trace of the real ComfyUI instance. PhotoSuite-owned ComfyUI input/output artifacts remain in that external service under UUID names; no unrelated files/history were deleted.

Known limits: only macOS Apple Silicon received native acceptance; no Windows/Linux runtime claim, signed distribution or hosted CI claim is made. Only the exact supported service versions, fixed SD 1.5 workflow, eligible topmost raster source and bounded ROI are supported. Capability checks establish model availability; actual model architecture is verified by generation. Original soft coverage is baked into output alpha, not an editable layer mask. The external service controls its own retention/network behavior. Other generation features and all M3+ work remain out of scope.
