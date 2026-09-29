# Post-M8 modernization integration audit

Audit date: 2026-09-28, America/Denver. Scope: stabilization, upstream integration, and release-readiness evidence; no new AI feature. Final verdict: **PASS WITH NOTES for the local development baseline; hosted CI and cross-platform release confidence remain unverified.**

## Evidence and Git boundaries

**D** = directly exercised in this audit; **S** = inspected source/configuration; **I** = inference bounded by the stated evidence; **U** = unverified. Native harness calls ran inside the actual bundled Tauri/WebKit app with real workers, models, and Rust IPC. They are not all physical menu clicks. Classic editing and the corrected transform controls were also exercised through native UI. Synthetic history-memory measurements are explicitly separate from native model execution.

The attachment's worktree premise was incorrect. The user explicitly corrected it: work in the main folder, with no additional worktree. Initial actual checkout was clean on `codex/m8-generative-expand` at `96e33e399e39ac03dfb5dd416006391b3866c5c0`; the requested `codex/modernization-stability-audit` branch was created there. The primary folder therefore **was intentionally modified under the user's corrected instruction**. No worktree was created, no cleanup/reset/stash was used, and no deferred M5a material was changed. There was no untracked M5a material in the starting working-tree inventory. No push, main merge, tag, release, or history rewrite occurred.

- Accepted M8 and verified origin source: `96e33e399e39ac03dfb5dd416006391b3866c5c0`.
- Verified upstream main: `8e9768ffd7fb54f8617f6cc3f941a01435895481`.
- Original merge base: `be4f9e6a8f288f6ff27b7eea8481b69918698fcc`.
- Final production-code commit: `dd249e0` on `codex/modernization-stability-audit`; the subsequent documentation commits contain this report and receipts.
- Full raw logs, native scripts, saved PSD/PSB files, and process samples are retained outside the package at `/Users/joe/Documents/Codex/2026-09-28/photosuite-stability-audit/`. Compact evidence is in [stabilization-evidence](stabilization-evidence/).

## Upstream integration and fixes

Reviewed all four upstream commits after the merge base:

| Commit | Content | Integration |
|---|---|---|
| `cdf520585bb84563a299704894bd87368e22a55c` | 32-bit float conversion, ZIP prediction, Lr32 layers, tests | Normal merge |
| `99e20e46655c061fc1834cc4794d17fa72868b7e` | Merge upstream PR #47 | Preserved ancestry |
| `57d0b764adf3e984d42ecca7eda8aad8b8d69816` | Fallback font licenses and references | Normal merge |
| `8e9768ffd7fb54f8617f6cc3f941a01435895481` | Merge upstream PR #52 | Preserved ancestry |

The only textual conflict was README. Resolution retained upstream font attribution and modernization documentation. PSD resource parsing was reviewed despite its clean automatic merge: Lr16/Lr32 handling and M7 malformed/duplicate layer-ID rejection coexist. No side was selected wholesale.

Created local commits:

1. `79971ff` — `merge: sync upstream PhotoSuite fixes`.
2. `4fc3e66` — `fix: stabilize modernization notices and release defaults`.
3. `b9ee791` — `ci: validate JavaScript and Rust modernization`.
4. `dd249e0` — `fix: preserve Smart Object persistence and transform controls`.
5. `57e2552` — documentation and evidence.
6. Final documentation correction records the native ad-hoc signing inspection.

Two concrete classic-editor defects emerged during native acceptance, both inherited from the pre-modernization source:

- **Fixed Blocker: Smart Object persistence.** The editor stores `layer.add.placedData`, but PSD additional-info writing recognized only `SoLd`; save silently skipped the descriptor. Native reopen confirmed the Smart Object and Smart Filters were lost. The boundary now writes the standard `SoLd` tag and reads it into `placedData`. A captured native Gaussian Blur descriptor round-trips through real descriptor encoding/decoding for PSD and PSB. Both new tests fail against the previous source. Final native save/reopen preserves the descriptor, filter list, linked content, and rendered pixels. The diagnostic reconstructed the original UI-created descriptor in the pre-fix saved file; this setup is recorded in the harness rather than represented as a fresh UI conversion.
- **Fixed Medium: Free Transform width.** The toolbar read nonexistent affine component `.w` instead of `.a`, displaying `NaN%` and propagating non-finite values into subsequent scale edits. The one-field fix has a regression that exercises production event/math paths with view-only stubs, preserves width when height changes, and fails before the fix. Final native UI shows `100.00%`, accepts height `90.00%`, commits and undoes normally.

Other fixes: eliminate the inherited named Developer ID default; refresh the Rust notice appendix to the actual 520 locked dependency records; use `cargo metadata --locked` in the notice generator; add ordinary JS/Rust branch/PR CI; add actual 32-bit PSD integration fixtures and a reproducible M8 history-memory diagnostic. Cargo.lock and npm lockfile were not upgraded.

## Architecture, races, and cleanup

| Boundary | Evidence and verdict |
|---|---|
| M0 exact permanent transactions | **D/S PASS.** Exact-result authority remains private; Accept uses prepared transactions, snapshots, rollback and ordinary history. Preview/Discard create no permanent edit. |
| M1 lifecycle | **D/S PASS.** One active provider, queue bound 2, retained-result bound 3, 48 MiB copied-input limit, 32 summaries. Cancel retains the active slot until provider settlement; terminal cleanup drops input/context/result/adapter/session references. |
| M2 transport | **D/S PASS within tested scope.** Shared Rust transport remains the single backend path. No duplicate lifecycle or provider-side document mutation was introduced. |
| M3/M4 | **D/S PASS.** Coverage producers have copied inputs; worker output is transient. Subject/selection/mask commits remain explicit. |
| M5b | **D PASS.** Accepted 4× result opens an independent raster document; source snapshot/history unchanged. Closing it does not invalidate source authority. |
| M6 | **D PASS.** Three candidates, switching, Discard, subsequent Accept, and provenance all exercised on the same document. Candidates are session-owned and bounded. |
| M7 | **D/S PASS.** Bounded passive declarative metadata; no executable workflow semantics or inference during open/save/history. |
| M8 | **D/S PASS.** Detached preparation and exact atomic canvas/layer/mask/guide transaction survive Undo/Redo and PSD/PSB reopen. Existing exclusions remain enforced. |

Native cancellation covered Quick Select, Subject, Object Selection, Remove, Fill, Upscale and Expand with immediate and approximately 100 ms cancellation requests. Local source-edit invalidation produced stale states; accepting a source-bound preview while another tab was active left the other document unchanged; closing a pending Object Selection document cancelled it. No cancelled work committed. The harness's asynchronous snapshot means “immediate” is not proof of cancellation before provider entry; similarly a quick job can already be at preview when the delayed cancellation runs. Preparation, correction, newer-request, selection/history staleness, late completion and duplicate-response interleavings are covered by deterministic lifecycle/provider tests rather than claimed as exhaustive physical native races.

Source inspection found one lazily created selection-job bridge/observer; render-time pruning of operation labels/modes; terminal session maps, candidate buffers and expand/upscale previews released; M4 prompt overlays removed on Accept/end. Repeated native cycles returned modernization sessions/previews to zero and summaries stayed bounded. No demonstrated listener leak or unbounded accumulation was found. This is not a heap-dominator proof for every browser object.

## Native integrated and no-backend acceptance

The initial full sequence and the final rebuilt-app sequence used real local ONNX inference and ComfyUI 0.37.4 at literal loopback. Existing SD v1.5 inpainting and fixed Real-ESRGAN models were reused; no models were downloaded. Custom/API nodes were disabled on the audit-owned service.

The sequence exercised Subject Discard/retry/Accept/Undo/Redo; Object Selection with positive/negative corrections and Accept; background-mask Accept/Undo/Redo; AI Remove Discard/retry/Accept; three Fill candidates/switch/Discard and a new accepted candidate; recipe inspection/privacy serialization; independent Upscale accept/close; Expand Discard/retry/Accept/Undo/Redo; PSD and PSB save; service stop and exact reopen. The source mask was undone before AI Remove because its documented ordinary-unmasked-raster gate correctly rejects masked layers. The final sequence began with a physical brush edit and corrected transform/Undo on the same source.

With ComfyUI stopped, all four backend operations failed safely without pixel/history changes, local M3/M4 continued to work, prior AI results rendered, history worked, and files opened/saved. Backend-sentinel tests recorded zero calls from passive open/save paths. Final ordinary editing and save-after-reopen are recorded in the final acceptance receipt.

## ComfyUI ownership and configuration

**S**, supported by Rust protocol tests and **D** real IPC runs:

- Only literal HTTP `127.0.0.1` or `[::1]` endpoints with a port; no DNS hostname, credentials, extra path or query.
- Proxy disabled; redirects disabled; connection timeout 3 seconds, request timeout 15 seconds, overall job bound 15 minutes; bounded response/image decoding.
- Canonical request UUIDs, one owned active lease, fixed graph and workflow identity checked against returned job data.
- Unique owned output prefix, permitted output type/extension, no path separators or foreign subfolder; validated image type and dimensions.
- Targeted `/api/jobs/{id}/cancel`; no global `/interrupt` or queue clearing.
- AI Remove has separate configuration. Fill/Expand intentionally share the reviewed generation checkpoint but have distinct fixed workflow identities. Upscale has its fixed reviewed model. No silent model fallback.

An unrelated concurrent live backend job was **not** submitted; foreign-identity/targeted-cancellation confidence comes from source and deterministic protocol tests, not a claimed live concurrency observation. Transport constraints apply to this Rust client, not to all application networking.

## Resource and performance evidence

### M3/M4 mixed cycles

Three cycles ran M3 cold, Discard, M4 cold plus warm corrections, Discard, then waited beyond 30-second retirement. Modernization workers/sessions/embeddings were logically released. Initial sampling started after earlier model use, not at a pristine launch.

| Idle sample after cycle | Host RSS MiB | Editor WebContent RSS MiB | Inspector RSS MiB | AI workers |
|---|---:|---:|---:|---:|
| 1 | 414 | 3251 | 138 | 0 |
| 2 | 289 | 2018 | 103 | 0 |
| 3 | 255 | 1181 | 100 | 0 |

Editor WebContent observed peak was approximately 3.3 GiB. This exceeds the earlier M4-only approximately 2.2 GiB evidence, plausibly because mixed models share a longer-lived process. There was no monotonic idle growth across these cycles. WebKit/WASM allocator retention is **not** labeled a leak. It remains a meaningful **Medium resource risk** on low-memory systems; this machine does not establish an 8 GiB system acceptance threshold. The final app also starts a separate font worker for text; it must not be mistaken for a leaked AI worker.

### M8 retained history

The checked-in diagnostic uses real production M8 preparation/commit/history with synthetic generated pixels, not inference. It waits through event-loop/GC turns before measuring post-trim release.

| Source | Accepted expansions before source gate | Exact snapshot bytes retained | Array buffers retained → after ordinary history trimming |
|---|---:|---:|---:|
| 512² | 15 | 301,844,480 (~288 MiB) | 321,390,879 → 19,546,279 |
| 1000² | 4 | 128,184,000 (~122 MiB) | 174,723,019 → 28,436,711 |

The next operation failed the existing 16 MiB raster/mask source gate. Each receipt includes source/generated/composite before/after bytes and process memory. Exact Undo/Redo passed. One hundred ordinary history additions evicted the expansion entries and released backing arrays. RSS did not immediately fall, consistent with allocator retention. Near-limit diagnostic Undo/Redo reached about 577/688 ms at 512² and 180/255 ms at 1000²; these include verification/snapshot work and are not isolated UI timings. Keep the correct exact-history design; do not claim the 1024² gate makes memory cost negligible. Aggregate history remains a **Medium bounded cost** to track before raising limits.

### Representative performance

Initial integrated observations: M3 cold ~6.9 s, warm ~3.8 s; M4 first result ~8.8 s, corrections ~0.15 s; Remove ~15.7–19.4 s; Fill roughly 15–17 s/candidate; small 4× Upscale transport 337 ms plus alpha 116 ms and new-document 23 ms; Expand ~17.5–21.8 s. Native Expand preparation/preview/Accept was 31/4/103 ms; Undo/Redo including snapshot verification 17/24 ms. Final-run phase receipts are retained separately.

Compared with milestone documents, M3 warm inference (~3.7 s) and M4 first result (~8 s)/correction (~106 ms compute) are in the same range. M8's 103 ms Accept lies within the earlier native maximum 213 ms; differing fixtures prevent a strict benchmark ratio. No demonstrated material regression was isolated. Fresh final app acquisition reached its ready UI in about 2.9 seconds including automation overhead; no controlled startup benchmark or platform-wide latency promise is made.

## Metadata, serialization, and 32-bit import

**D/S:** M7 enforces a 2 MiB XMP pre-parse cap, DTD/ENTITY rejection, malformed XML rejection, namespace/schema validation, primitive field whitelist, strict IDs, bounded JSON/record count (64)/bytes, prompt bytes/units, timestamps/hashes/geometry. Native DTD, ENTITY, malformed, unknown-schema and oversized files preserved raster state and yielded no recipe or backend call. The sentinel was bound to port 8188, and native Comfy IPC was separately trapped during the offline pass.

Privacy modes recipes-on/prompts-off, recipes-on/prompts-on and recipes-off were serialized and reopened. Raw prompt text was present only when explicitly enabled; recipe namespace was absent when disabled; layer pixels unchanged. Rename/reorder and M8 preserved recipe association by ID. Duplicate/delete/Undo/Redo and invalid/duplicate IDs have deterministic coverage; this audit does not label every privacy combination as a fresh physical-UI test. Save to distinct PSD/PSB paths was exercised through native file writes; the Save As dialog itself was not the authority mechanism used by the harness.

- **Integrated files:** exact dimensions, pixel hashes, bounds, IDs, ordering, guides, recipes (with prompts omitted by default), and composite on native reopen.
- **28 retained M8 PSD/PSB fixtures:** native open plus reserialization covered groups, raster masks, negative bounds, guides, transparency and expanded documents. Only invalid group-end ID `null` versus `0` was normalized; valid positive IDs and all pixel hashes remained strict. A diagnostic-only detached parse initially omitted layer-tree rebuild; the harness was corrected, not the application.
- **Classic file:** vector shape/mask, text, raster mask, adjustment, Smart Object/Smart Filter and AI layers survive final native save/reopen with matching composite and raster content. Empty semantic-layer raster buffers are normalized only when width and height are both zero.
- **Independent reader:** psd-tools 1.21 opens emitted PSD/PSB, verifies dimensions, raster layer bytes/bounds, and recognizes the repaired Smart Object with linked data. Opaque integrated and 32-bit-converted saved composites match exactly. Transparent classic merged-image bytes differ from the live compositor because the inherited PSD writer white-mattes its merged RGB channels; layered native recomposition matches. The transparent classic diagnostic found zero alpha difference and zero opaque-RGB difference; partial-alpha RGB differed by at most 11 levels, with transparent RGB differing by up to 255. This is a bounded interoperability limitation, not evidence of Photoshop acceptance or a reason to weaken the exact layer checks.
- **Actual 32-bit fixtures:** independent generator writes real layered Lr32 files, raw float and ZIP-predicted float channels. Both native imports recover two actual layers, clamp and convert known negative/over-range samples without striping, permit an ordinary pixel edit/rename, and save RGB8 PSD/PSB. The targeted integration tests use actual zlib, not the suite's inflate stub. No HDR/32-bit editing or preservation claim.

## Classic editor smoke

Physical native UI exercised brush, eraser, spot healing, rectangular selection, crop/Undo/Redo, translation/scale controls, DejaVu text, rectangle vector shape, raster mask, brightness adjustment, Smart Object conversion, Gaussian Blur Smart Filter, and ordinary history. Native save/reopen followed. The two real defects above were repaired and reverified. This is meaningful smoke coverage, not exhaustive upstream QA; clone stamping was subsequently exercised through its native source-sampling control and contributed an ordinary history entry and saved pixels. A first uninstrumented clone Undo/Redo snapshot comparison differed; retry and a new stroke with complete before/after capture matched exactly. The original differing snapshot was not retained, so its cause is **unresolved** rather than attributed to timing or dismissed. No reproducible corruption was established; this limits the generic clone-history claim and warrants follow-up if it recurs.

## Package, dependencies, licenses, and release configuration

`frontendDist` is `../src`; root docs/tests/scripts are outside that tree. The actual debug `.app` is about 266.42 MiB (279,362,427 file bytes); its resource LICENSE and THIRD-PARTY-NOTICES hashes match the current repository. Frontend assets are embedded by Tauri. Three distinct ONNX files and one ORT WASM runtime were found; no duplicate model/runtime copy was found.

| Shipped asset | Bytes |
|---|---:|
| BiRefNet-lite ONNX | 94,377,615 |
| SAM2 encoder | 55,015,529 |
| SAM2 decoder | 8,681,263 |
| ORT WASM | 11,210,254 |
| ORT main JS / WASM loader JS | 48,259 / 20,854 |
| ORT third-party notices / license | 326,866 / 1,073 |
| BiRefNet license / model card | 1,066 / 8,715 |
| SAM2 license / notice / model card | 11,357 / 942 / 19,965 |

DejaVu, Droid Sans Fallback and Noto license files now ship under the font tree. Existing BiRefNet/SAM/ORT notices and model documentation remain. Notices distinguish bundled artifacts from external user-managed ComfyUI, SD inpainting checkpoint and Real-ESRGAN weights. The Rust appendix was stale and now matches the locked graph. This is a distribution inventory/license-text check, not a legal opinion.

Modernization npm addition `@xmldom/xmldom` remains dev/test-only. Rust reqwest/png/uuid support the shared bounded transport and image/identity validation. Existing overlapping transitive crates were not mass-upgraded or removed. No demonstrated unused new runtime dependency justified additional change.

**Large-model strategy:** keep current clones/offline builds working now. BiRefNet is ~90 MiB, close to GitHub's [100 MiB ordinary-file cap](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github). Before the next model update, choose either forward-only LFS with CI/offline provisioning and quota ownership, or immutable release artifacts with pinned SHA-256, size bounds, explicit download/provisioning, mirrors and license notices. Prefer deterministic verified provisioning for future artifacts once a reliable offline cache/build path exists. Do not rewrite pushed history. [Git LFS semantics](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage) do not by themselves solve availability or billing.

Product name `PhotoSuite`, identifier `app.photosuite`, version `0.9.14` remain unchanged. The fork's release identifier/version policy needs the user's decision; these values may collide with upstream installations. Named upstream Developer ID was removed; signing/notarization requires explicit environment/CI secrets. Local validation was an ad-hoc linker-signed debug executable, with no Developer ID, no TeamIdentifier, and no sealed bundle resources; it was not a notarized installer or public release.

## CSP and test quality

`csp: null` predates modernization and remains a **Medium hardening gap**. Legitimate existing behavior includes bundled model fetch/WASM workers, fonts, plugin frame/srcdoc behavior, web-image/network features and Tauri IPC. A blind policy risks breaking ordinary tools and plugins. Future work should inventory actual origins, isolate plugin capabilities, and test a staged policy across native plugin/image/font/model/IPC flows before production enforcement. No global network restriction is claimed here.

The deterministic suite exercises real transaction, freshness, cancellation, rollback, byte-bound and serialization contracts, with host/inference behavior mocked where appropriate. It cannot prove ONNX quality, WebKit memory reclamation or real backend transport timing. Existing duplicate export-smoke coverage is low-value maintenance debt, not grounds for deleting useful tests in this pass. Added tests target observed defects and the upstream 32-bit integration gap: real compressed layered fixture decoding; Smart Object binary tag/descriptor persistence; finite transform width with subsequent height editing. Each bug regression was observed to fail before its fix. Ordinary CI still requires no AI models or ComfyUI.

## Hosted CI and platform evidence

**D investigation:** repository Actions API says enabled, allowed actions `all`, workflow token permissions `read`; caller has repository admin capability. The default-branch workflow file exists, yet Actions reports zero registered workflows and zero runs, with no M8 check runs. Lookup/authorized dispatch of `build.yml` at the pushed M8 ref returned HTTP 404: workflow not found on the default branch. No run was created. The exact registration/fork-activation cause is **unconfirmed**; billing was not established as the cause. No settings were changed, and the local audit branch was not pushed without permission.

**S configuration:** JS branch/PR checks run recursive checkout, npm ci, vendor fixlinks, lint, verify, test. Same-repository PR merge results are no longer skipped. Rust branch/PR checks install native Linux dependencies, run locked cargo check/test and notice freshness. Three real-backend Rust tests remain ignored/opt-in. Full installers remain manual/tag-only and depend on both checks. Platform configuration retains macOS app/DMG, Windows NSIS, Linux DEB/RPM outputs.

| Lane | Result |
|---|---|
| Local JS | 2,126 tests, 424 suites, all pass; no skips; lint and all 8 verify checks pass |
| Local Rust | cargo check pass; 25 tests pass, 3 live-backend tests ignored; binary/doc test targets pass |
| Diff hygiene | git diff --check pass; no Rust source change requiring rustfmt |
| macOS native | Final debug Tauri build and actual integrated app acceptance pass |
| Hosted JS / Rust | **U: no registered/runnable workflow; no green hosted result** |
| Hosted macOS / Windows / Linux builds | **U: dispatch unavailable; no compile/bundle claim** |
| Windows/Linux runtime | **U: not performed** |
| Signing/notarization/release | **U: not performed** |

An early concurrent Cargo/Tauri build invalidated doctest artifacts; serialized retry and final serialized checks passed. npm's shared cache had an ownership error; a task-specific cache was used. These environment failures are retained in logs and are not hidden as product defects. ORT source-map warnings in the debug inspector do not prevent model execution.

## Severity and adoption decision

| Severity | Finding | Disposition |
|---|---|---|
| Blocker | Smart Object/Smart Filter descriptors lost on save | **Fixed**, deterministic and native PSD/PSB evidence |
| High | None remaining demonstrated | No claim of exhaustive absence |
| Medium | Transform width NaN and dependent scale corruption risk | **Fixed**, regression and native controls |
| Medium | Hosted workflow unavailable; JS/Rust/platform build confidence missing | Unresolved external validation gate |
| Medium | Mixed-model WebContent peak ~3.3 GiB and retained M8 history cost | Bounded measurements; low-memory acceptance still needed before raising limits |
| Medium | Inherited null CSP | Documented future native-tested hardening work |
| Medium | One uninstrumented clone-history comparison discrepancy, not reproduced on retry/new stroke | Retain as validation uncertainty; no speculative fix |
| Medium | Regular-Git model size near per-file cap | Forward-only provisioning strategy required before growth |
| Low | Transparent merged-image matte/quantization interoperability limit; debug source maps; duplicated shallow test coverage | Documented; layer/native persistence remains verified |
| Decision | Fork identifier/version/signing ownership | User decision before distribution; named upstream signing default removed |

The code is suitable as a **local stabilized development baseline with these notes**. Before designating it the shared accepted base or starting M9/M10 implementation on top of an accepted milestone, push only with explicit authorization, resolve workflow registration, and obtain green hosted JS/Rust checks plus the requested manual build matrix. M9/M10 were not started. This audit does not authorize publication or convert unavailable hosted evidence into a pass.

## Completion checklist (requested 45 items)

| # | Result |
|---:|---|
| 1 | Actual starting branch `codex/m8-generative-expand`, SHA `96e33e399e39ac03dfb5dd416006391b3866c5c0`; corrected folder premise documented above. |
| 2 | Accepted M8/origin source matches `96e33e399e39ac03dfb5dd416006391b3866c5c0`. |
| 3 | Upstream `8e9768ffd7fb54f8617f6cc3f941a01435895481`. |
| 4 | Final branch `codex/modernization-stability-audit`; production SHA `dd249e0`, followed by this report commit (final delivery gives its SHA). |
| 5 | Four reviewed upstream commits integrated, listed above. |
| 6 | README conflict reconciled; PSD automatic merge independently reviewed. |
| 7 | Four implementation/integration commits plus two audit documentation commits. |
| 8 | Workflow, README/notices, crate-notice generator, signing config, PSD codec/resource parser, transform toolbar, three font licenses, focused tests/fixtures, two stabilization diagnostics, audit report/evidence. Exact manifest retained in evidence. |
| 9 | Actual raw/ZIP-predicted Lr32 imports and RGB8 edits pass; no high-bit-depth preservation. |
| 10 | Shipped/external notices distinguished; font licenses added; Rust appendix current. |
| 11 | Hosted JS unverified/unavailable, not green. |
| 12 | Hosted Rust unverified/unavailable; ordinary lane now configured. |
| 13 | M0–M8 architecture boundaries retained. |
| 14 | Initial and final integrated native sequences pass within stated coverage. |
| 15 | Native cancellation/source/tab/close cases pass; remaining interleavings deterministic. |
| 16 | Terminal buffers/session/preview authority cleaned up; bounded job summaries. |
| 17 | AI workers/embedding released; no monotonic idle RSS growth observed; peak risk remains. |
| 18 | Exact history retained cost measured; trimming releases buffers; no speculative rewrite. |
| 19 | Shared transport fail-closed constraints retained; foreign concurrent live job unverified. |
| 20 | Distinct operation contracts/settings; intended Fill/Expand checkpoint sharing. |
| 21 | Hostile native metadata sentinel and privacy serialization pass. |
| 22 | Integrated + 28 retained files + fixed classic PSD/PSB; independent-reader limits stated. |
| 23 | Native classic smoke found and fixed Smart Object persistence and transform width defects. |
| 24 | Local tools, ordinary editing, persistence and safe backend failures verified with service stopped. |
| 25 | Actual package/notices checked; three unique models and one ORT runtime; asset sizes above. |
| 26 | Keep current artifacts; plan forward-only verified provisioning/LFS before growth; no history rewrite. |
| 27 | Upstream identity default removed; name/identifier/version retained for user decision. |
| 28 | Null CSP remains documented; no global network-enforcement claim. |
| 29 | Test-only xmldom and required Rust runtime dependencies confirmed; no mass upgrades. |
| 30 | Targeted real-codec/descriptor/math regressions added; mock/native boundaries explicit. |
| 31 | Representative timing comparable to milestone evidence; mixed-model memory cost exposed. |
| 32 | macOS native debug build/integrated acceptance pass; no signed release claim. |
| 33 | Windows hosted build unavailable; runtime untested. |
| 34 | Linux hosted build unavailable; runtime untested. |
| 35 | One inherited persistence Blocker found and fixed; none remaining demonstrated. |
| 36 | No remaining demonstrated High finding. |
| 37 | CI evidence gap, resource costs, CSP and Git asset strategy. |
| 38 | Transparent composite interoperability limitation, debug source maps, shallow test debt. |
| 39 | Upstream sync, notices/signing/CI fixes, actual 32-bit regression, Smart Object and transform fixes. |
| 40 | Hosted registration/build evidence, low-memory envelope, unexplained first clone-history comparison, future CSP and release identity decisions. |
| 41 | JS 2126/2126; Rust 25 pass/3 ignored; lint/verify/check/build/diff pass. |
| 42 | M5a untouched. Primary folder was modified with explicit corrected authorization; an untouched-primary claim would be false. |
| 43 | Suitable local baseline; gate shared acceptance on real hosted checks/builds. |
| 44 | Do not begin M9/M10 implementation before accepted-base/CI gate is resolved. |
| 45 | **PASS WITH NOTES** for this bounded local audit; no hosted/release PASS. |
