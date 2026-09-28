# M1: job lifecycle and responsive Quick Select

M1 produces results; M0 commits them. The implementation remains entirely
internal, offline JavaScript. It adds no model, service, plugin API, native
permission, special layer, inference runtime, or persistence format.

## Flow and state

`Quick Select stroke -> owned request -> queue -> worker -> overlay -> Accept -> M0`

`ModernizationJobs` in `src/features/modernization/job-service.js` owns explicit
`queued`, `preparing`, `running`, `preview`, `committed`, `discarded`, `cancelled`,
`failed`, and `stale` states. All transitions are checked. Accept and Discard
require a live preview; cancellation is idempotent in every nonterminal state.
Terminal jobs hold only bounded summaries, never requests, results, editor
contexts, or adapters. Errors distinguish invalid requests/transitions,
unsupported operations, resource limits, provider failures, worker failures,
malformed results, cancellation, document close, and stale sources.

The application lazily constructs one `SelectionJobs` owner. Its service permits
one executing workload, two queued requests, and at most three live jobs total
(including previews). Previews do not occupy the execution slot, but consume the
live-job budget. Up to 32 lightweight terminal summaries are retained. Queue and
byte-limit errors are synchronous and predictable. FIFO order is deterministic.
A new revision cancels the previous request in its session. Each session has a
monotonically increasing revision and each job a unique application request ID.
A stopped A may deliver after B; its closed execution token has no authority to
publish progress, previews, or commits.

## Provider and ownership boundary

A provider implements `validateInput`, `start`, and `copyResult`, with optional
result cleanup. `start` receives copy-owned plain data, identity, an AbortSignal,
and progress/completion/failure callbacks. Its returned cancellation function
must return `true` only if execution has actually stopped. No document, layer,
controller, plugin frame, history, or Tauri object crosses that boundary.

The service validates limits before copying. It copies logical byte views rather
than their entire backing stores and rejects non-data objects. The editor adapter
separately retains an exact source snapshot. The dedicated worker receives only
transferred *copies*: live editor buffers are never detached. Returned coverage
is validated and copied into service ownership; the transient overlay borrows
that retained copy. M0 makes its own retained history copies at Accept.

Quick Select inputs are bounded to 4,194,304 pixels for both layer and canvas,
1–8192 pixels per dimension, 32 completed strokes, and 48 MiB of request bytes.
These are conservative M1 limits, not an estimate of all graph memory. Graphs,
segmentation, color models and intermediate masks exist only inside one worker
and are destroyed with it. Queued copies, freshness snapshots, preview bytes and
session marks are released on terminal transitions. A cancelled uncooperative
provider may still hold its own input until it finishes; it keeps the execution
slot and the UI explicitly reports that it is still stopping.

## Cancellation, errors and worker recovery

Queued cancellation removes the request immediately. Preparing cancellation
prevents provider dispatch. Running cancellation revokes acceptance synchronously,
aborts the signal, removes transient resources, and attempts provider stop.
Uncooperative workloads cannot block safety: late or duplicate results are
ignored/disposed. They can delay subsequent work until actual settlement.
Cancelling or discarding a preview removes the overlay without touching document
selection, pixels, or history. Staleness similarly revokes the result and signals
stop. A closed document cancels its jobs before its M0 session is revoked.

The Quick Select provider terminates its dedicated worker on cancel, completion,
message failure, or crash. Each new execution creates a fresh worker, making
retry independent of previous failure. There is no synchronous fallback that
would hide a worker failure by blocking the UI. Stage progress is indeterminate
(`Analysing image`, `Refining`); no percentage is invented. The generic contract
also permits validated numeric progress when a provider genuinely measures work.

## Freshness and M0

Freshness is checked before provider dispatch, before preview, every 500 ms for
live sessions, and synchronously at Accept. The adapter retains:

- M0's runtime document/session identity, complete layer-object stack, stack
  metadata, canvas dimensions, channel state, exact selection snapshot, and
  history array/entry identities plus history head;
- the actual source layer object, its document-space region and relevant mode/
  metadata, and all source RGBA bytes.

Source comparison is an exact word/byte scan with an unaligned fallback. The old
first-pixel Quick Select fingerprint and history index alone provide no authority.
Tab switches do not change the target. Close/reopen with the same filename gets
a different document identity. Deletion, replacement, geometry changes and
reordering are conservatively stale (M0 requires the captured stack). Undo/Redo
or history branching that changes the captured state is stale. If a later Undo/
Redo restores *every* captured identity, history entry and relevant byte exactly,
it is safe; no unsupported mutation epoch is assumed.

Gestures in another part of the editor do not themselves change source freshness.
Accept additionally requires M0's real idle-editor guard (no pointer gesture,
transform or dialog). If that guard fails the preview becomes stale and must be
rerun. The adapter calls `prepareExactResult` then `commitExactResult`, validates
the receipt, and only then marks the job committed. The M0 transaction and its
rollback/history code are unchanged. Undo/Redo uses retained editor bytes and
never starts a provider.

## Quick Select proof and UI

The Quick Selection brush keeps the existing brush rasterizer, descriptor and
pressure behavior and preserves document coordinates. Brush gestures only paint
private mark buffers. Completed strokes submit foreground/background marks;
subsequent strokes replay the bounded correction sequence over the original
source and, for Unite/Subtract sessions, the initial selection. Soft inherited
coverage is preserved within the source region as in the existing algorithm.

The existing graph algorithm was extracted, without algorithm changes, into
`quick-select-computation.js`. Superpixel segmentation, graph construction, cuts,
color models and boundary refinement all execute in the new module worker.
The main thread retains brush rasterization, input copies, exact validation,
overlay rendering and the bounded M0 commit. Corrections are resolved once per
completed stroke, rather than after every pointer sample. Graphs are rebuilt and
completed marks replayed for each revision; M1 does not introduce a resident graph
cache or session workers. These tradeoffs bound ownership and simplify cancellation.

A small Quick Select status strip displays operation, originating document,
stage, Cancel, and preview Accept/Discard. The existing mask overlay renderer
shows a transient tint held in `toolOverlayState.jobSelectionPreview`; document
selection is untouched until acceptance. It is neither a real layer nor a history
entry. Replacing, cancelling, discarding or invalidating the owning job clears
only its own overlay. Other editing tools continue to act on the committed
selection. Use Accept before applying another operation to the preview.

The older Object Selection rectangle path still uses its synchronous legacy
session. It is not advertised as asynchronous. Quick Select remains classical
and offline. This milestone does not redesign its segmentation quality, add
per-pointer preview updates or add model-based subject recognition. Limits, English
status strings, conservative reorder invalidation, per-stroke replay, synchronous
copy/validation/commit costs, and local macOS-only native acceptance are known
M1 limitations. See [native acceptance](M1-NATIVE-ACCEPTANCE.md) for observed
costs and exact evidence.

## Validation

Deterministic test-only providers expose explicit delivery hooks; no sleep-based
race tests or neural models are used. Tests cover FIFO/capacity, all terminal
states, cancellation at preparation/delivery boundaries, uncooperative providers,
late/duplicate/out-of-order completion, cleanup failure, source and document
lifecycles, malformed output, transfer detachment, a real module worker, worker
restarts, soft coverage, correction replay, and real M0 history/rollback behavior.
Required gates are `npm test`, `npm run lint`, `npm run verify`, `git diff --check`,
and actual Tauri acceptance. Rust tests are required only if Rust changes.
