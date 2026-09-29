# M1 native acceptance and completion record

Date: 2026-09-27, America/Denver. Host: local macOS. Scope: actual Tauri
PhotoSuite application, classical Quick Select, disposable PSD fixtures.

## Git provenance

- Starting branch: `codex/m1-job-lifecycle`.
- Starting SHA and existing documentation baseline:
  `24d6847532beffaba14efd8d2c2deff5e46aceb9`.
- Baseline message: `docs: preserve modernization roadmap and M0 native acceptance`.
  It already existed on entry; no duplicate baseline commit was needed.
- Accepted M0: `a86c4548d5b22b3777647ef329f391ed2ee000d8`, unchanged.
- Final branch: `codex/m1-job-lifecycle`; the implementation commit containing
  this record is reported by SHA in the completion response.
- No push, merge, tag, release, installation of inference software, or M2 work.

## Native method

Built the existing Tauri app with `npm run build -- --debug --bundles app --no-sign`
after sourcing the installed Cargo environment. The final build succeeded in
20.42 seconds and produced the local 121.89 MiB unsigned debug bundle at
`src-tauri/target/debug/bundle/macos/PhotoSuite.app`. This is local build/native
evidence, not signing, release, hosted CI, or cross-platform acceptance.

Native pointer gestures, Quick Selection tool selection, status-strip buttons,
tab switches, tab close, and Edit-menu Undo/Redo were driven in the running app.
Web Inspector instrumentation read actual document/history/overlay bytes and
worker messages and sampled animation frames. The source-change race used a
one-byte mutation of the real source layer while its real worker was running;
it did not create a synthetic history entry. The byte was restored afterwards.
Instrumentation was temporary console code, not a shipped testing API or plugin.

Fixtures were a 256 × 192 orange/blue image and a deterministic 2048 × 2048
textured orange disk on blue. The latter was generated with the application's
PSD writer, then opened through the native application. All job computation was
local; no model, network inference, or runtime download was involved.

Raw local evidence, fixture generator, assertion script and logs are retained
outside the repository at:
`/Users/joe/Documents/Codex/2026-09-27/photosuite-m1-native-acceptance/`.
The evidence receiver accepted local loopback JSON only. Native observations
below are distinguished from automated Node tests.

## Observed acceptance

| Required behavior | Observed result |
| --- | --- |
| Application launches | Packaged native debug app launched and opened both PSD fixtures. |
| Ordinary editing | Native brush changed source pixels and added one normal history operation; accepted selection remained byte-identical. |
| Classical selection | Quick Select produced the expected foreground coverage using the existing offline graph algorithm. |
| Async start and visible state | Real pointer strokes started dedicated workers; status strip showed Analysing image and Cancel, then preview controls. |
| Responsiveness | Animation frames continued during graph work; actual Cancel and tab switches were processed while workers ran. Measurements are below. |
| Cancel | Native Cancel during analysis left history at one Open entry, no selection or overlay, and exact source pixels; input/result ownership was released. |
| Rerun and preview | Subsequent native strokes ran successfully and displayed a transient tinted overlay with Accept/Discard. |
| Discard | Preview disappeared without selection, pixel or history changes, including when a different tab was active. |
| Accept | Native Accept added exactly one `tools.quickSelection` history operation. |
| Undo | Native Edit Step Backward restored the prior empty selection and exact source pixels; history head returned to Open. |
| Redo | Native Edit Step Forward restored the accepted selection bytes exactly. Job count did not increase. |
| Source change during work | A non-leading RGBA byte changed while the real job was running; result became stale, overlay disappeared and history stayed unchanged. |
| Switch tabs | The running large-image job reached preview on its original document while the small-image tab was active; neither document was redirected or incorrectly edited. |
| Close source | Native tab close during analysis cancelled with `document-closed`; later observations showed no overlay, selection, history or pixel mutation on the closed object or other tab. |

The initial native pass has ten programmatic assertions over recorded runtime
receipts, covering the cases above. Final bundle regression results are recorded
below after rebuilding the final production sources.

The final bundle was launched and its bundled source checked for the exact word
scan, private brush buffers and live-job UI priority. A fresh native run repeated
Cancel during analysis, rerun to preview, Discard, rerun, Accept, Edit Step
Backward and Edit Step Forward. Byte assertions passed for unchanged source,
empty prior selection/history before Accept, exactly one new M0 operation, exact
Undo/Redo coverage, and no new job on Redo. All three jobs ended with no retained
input/result. The native evidence verifier passed 19 distinct checks, including
eight final-bundle assertions and a final frame/resource check.

The Mac lock and a transient system focus overlay interrupted this final pass;
testing resumed after unlock and a clean relaunch of the same debug bundle.
These were test-session interruptions, not product failures. No PSD fixture was
saved over its source. Temporary app instrumentation and the loopback evidence
receiver were stopped after the receipts were verified.

## Automated validation

All required commands exited zero against the final production sources:

| Gate | Result |
| --- | --- |
| `npm test` | 1,839 tests, 422 suites, 0 failed/cancelled/skipped; 9.48 seconds. |
| `npm run lint` | Passed. |
| `npm run verify` | All eight repository checks passed, including zero import cycles. |
| `git diff --check` | Passed. |
| Rust tests | Not required: no Rust, Cargo, Tauri configuration or dependency files changed. |

There are 59 new deterministic tests. They cover explicit queued/preparing/running/
preview and terminal transitions, FIFO/capacity, delivery/cancel races, duplicate
and out-of-order completion, retained-resource release, exact source changes,
document close/reopen, target replacement/deletion/reorder, history movement,
active gestures/dialogs/transforms, rollback, malformed output, limits, worker
transfer/crash/restart, graph equivalence, soft coverage and correction sequences.
Real Quick Select brush tests also check coordinates, private scratch ownership,
Shift behavior and absence of document mutation before acceptance. Controlled
fake deliveries use explicit synchronization rather than timing sleeps. A Node
worker bridge additionally executes the actual production worker module.

## Measurements

Initial large-fixture worker run: 628 ms analysis/graph preprocessing and 34 ms
refinement; a second run measured 692 ms and 36 ms. The initial completed run
had 41 animation frames while running, with a largest observed frame gap of
93 ms. A cancelled run had 31 frames with a 94 ms maximum gap. Submission copy/
capture cost in that cancellation scenario was 3 ms. These are observed local
samples, not a frame-rate guarantee or benchmark across hardware.

The initial exact-source comparison used a callback per RGBA byte. It was
replaced with an exact word scan, preserving an unaligned byte fallback and
full byte equality, to reduce main-thread validation cost. This does not weaken
freshness into a hash or sampled fingerprint. The final bundle was separately
checked to contain that scan, private brush mark buffers, and live-job UI priority.

Final rebuilt-bundle samples on the large fixture:

| Scenario | Input copy/capture | Worker analysis | Worker refinement | Frames during running | Maximum observed frame gap |
| --- | --- | --- | --- | --- | --- |
| Cancel during analysis | 7 ms | Terminated | Not reached | 29 | 37 ms |
| Preview then Discard | 6 ms | 1,578 ms | 130 ms | 104 | 35 ms |
| Preview then Accept | 5 ms | 1,565 ms | 132 ms | 104 | 43 ms |

These samples include inspector instrumentation on the native debug build. The
worker timings varied from the earlier session; they are not a controlled before/
after speed comparison. They demonstrate that graph work lasting about 1.7 seconds
ran while animation frames and native controls remained responsive. Exact byte
assertions ran after the job left the running state and are not included in the
running-frame measurement. Main-thread copying, validation, rendering and commits
remain visible costs; M1 does not promise every frame stays below 16.7 ms.

## Implementation map

Added production files:

- `src/features/modernization/job-service.js`: checked lifecycle, bounded FIFO,
  cancellation, revision authority, progress, ownership and structured errors.
- `src/features/modernization/selection-jobs.js`: application sessions, UI,
  periodic freshness, close handling and stroke replay requests.
- `src/features/modernization/selection-target.js`: exact source proof, overlay
  adapter and calls into unchanged M0 preparation/commit.
- `src/features/modernization/quick-select-provider.js`: dedicated worker
  transport, transfer ownership, termination and restart.
- `src/features/modernization/quick-select-worker.js`: worker protocol entry.
- `src/features/modernization/quick-select-workload.js`: bounded plain inputs,
  deterministic stroke replay and validated coverage results.
- `src/engine/compositing/quick-select-computation.js`: extracted existing graph,
  segmentation, color-model and boundary-refinement computation.
- `src/document/tools/quick-select-gesture.js`: private mark rasterization using
  existing brush and coordinate/pressure/Shift behavior.

Modified production files:

- `src/document/tools/quick-select-session.js`: legacy delegation to extracted
  computation; the Object Selection path stays synchronous.
- `src/document/tools/selection-tools.js`: Quick Selection gesture integration.
- `src/ui/shell/app-controller.js`: lazy owner, periodic checks, document close.
- `src/ui/panels/plugin-tool-overlays.js`: transient job coverage rendering.

Added tests: `job-service.test.js`, `selection-jobs.test.js`,
`quick-select-worker.test.js`, `fake-provider.js`, and `node-selection-worker.js`
under `tests/features/modernization/`. Added documentation: this file and
`docs/M1-JOB-LIFECYCLE.md`. Roadmap and M0 acceptance baseline remain unchanged.

## Architecture and bounded deviations

See [M1 job lifecycle](M1-JOB-LIFECYCLE.md) for states, provider contract,
cancellation, exact freshness, transient preview, and ownership rules. One
workload executes at a time, with two queue positions and three live jobs total.
Providers receive copied plain data and callbacks, never editor/native authority.
Cancel revokes acceptance immediately; a provider that cannot stop keeps the
execution slot until settlement. Superseded session revisions and late/duplicate
responses cannot publish. Only Accept invokes the existing M0 boundary; no
history is produced for preview/discard and Redo never invokes a provider.

Limits and deviations are intentional: 4,194,304 pixels per layer and canvas,
8192 maximum dimension, 32 strokes, 48 MiB request budget; full graph rebuild
per completed stroke; no live pointer-sample graph preview; conservative stale
rejection on stack reordering; English status strings; main-thread copying,
exact scans, overlay and commit still have bounded cost. Object Selection remains
synchronous. Native acceptance is local macOS debug only. No M2, AI model,
inference runtime, remote service, plugin job API, special persistence layer,
compositor redesign or color/RAW work was started.

## Verdict

**PASS WITH NOTES.** Required automated validation and actual native acceptance
passed. The bounded size/stroke limits, per-stroke replay, synchronous Object
Selection, main-thread copy/validation costs and macOS debug-only acceptance are
the notes. Production behavior satisfies the complete M1 lifecycle: asynchronous
production, cancellation, transient preview, stale rejection and explicit M0
acceptance without premature history or late-result authority.
