# Exact result transactions (M0)

M0 accepts prepared pixels and coverage through the existing Document, Layer,
Mask, selection action and tracker history infrastructure. It does not perform
segmentation or run models. Layer → **Remove Background from Selection** is the
built-in consumer. Its source is the current selection, interpreted as foreground.

## Editor behavior

- `insertRaster` creates an ordinary RGBA8 raster layer at the supplied integer
  document-space rectangle. Negative origins are allowed. Pixels are straight
  alpha in the editor's existing RGB8 representation; no profile conversion is
  performed. Names may duplicate existing names. The anchor is explicit: insertion
  is above a normal/closed-group anchor, inside an open group. Source layers are
  preserved and the result is selected. There is no file open or transform step.
- `setSelection` replaces selection using the same preparation and undo/redo
  action as `setsel`. Coverage 0 excludes, 255 includes, intermediate values remain
  soft. Zero-only input deselects; full-canvas white input remains an explicit
  selection. Empty border trimming follows the existing selection path.
- `applyRasterMask` supports `create` (reject an existing raster mask) or
  `intersect` (default). Intersection uses `Mask.combineWith`: effective coverage,
  including feather, density and outside coverage, is multiplied and baked into
  ordinary coverage bytes. The combined mask has density 255 and feather 0;
  its linked flag comes from the existing mask. The original properties are
  restored exactly on undo. Existing disabled masks require enabling first.
  No silent replacement mode is provided.
- Remove Background requires one visible, unlocked ordinary raster layer and an
  existing selection. It uses zero outside coverage, preserves original pixels
  and any vector mask, and intersects any compatible existing raster mask. It
  leaves the selection in place. Select All reveals the canvas and hides pixels
  outside it. No selection produces a clear error. Smart objects, text, fills,
  groups, locked/background layers, artboard documents, non-RGB channel editing,
  active gestures, transforms and dialogs are conservatively rejected.

Masks use document-space coordinates even when the layer has a nonzero or
negative origin. The existing layer layout stores the editable raster mask in
`warpData` when an enabled vector mask coexists, and the derived render mask in `d`.
Neither source pixels nor the existing vector mask is baked into the raster mask.

## Version 1 plugin protocol

Existing `{psPlugin: 1, cmd, requestId}` commands `ping`, `getComposite` and
`getSelectionMask` keep their reply shapes. Selection export now trims internal
alignment padding: a 3×5 mask returns exactly 15 bytes.

1. Send `getCapabilities` with `apiVersion: 1`. The `capabilities` reply includes
   `sessionId`, `nextSequence`, `operations`, `pixelFormats`, and `limits`.
2. Send `getDocumentInfo`. The `documentInfo` reply has `documentId`, width, height,
   `hasSelection`, and layer summaries (`layerId`, name, kind, selected).
3. Send `prepareResultTarget` with `documentId`, `operation`, and `layerId`
   (required for raster/mask writes; ignored for selection). It returns
   `resultTarget` with a one-use `targetToken`.
4. Send the chosen operation, `documentId`, `targetToken`, and `payload`.
   Success is `resultCommitted` with operation and documentId. Errors retain
   the standard `{psPlugin: 1, cmd: "error", requestId, error}` shape.

Every request after capabilities in this new protocol requires `apiVersion: 1`,
`sessionId`, a nonempty `requestId` (≤128 characters), and a `sequence` exactly
one greater than the last accepted sequence. Start at `nextSequence`. Validation
of these envelope fields precedes sequence consumption; operation errors consume
an accepted sequence. Unknown/legacy commands do not consume it. Capabilities
can be requested again to recover the expected sequence. Only one target per
frame session is retained; preparing another discards the old one. A write attempt
consumes its target, including a failed write. Never blindly retry an uncertain
write after losing its reply: inspect the document before requesting another.

Example insertion payload:

```js
{
  pixelFormat: "rgba8",
  rect: { x: -3, y: 7, width: 3, height: 5 },
  byteLength: 60,
  bytes: new Uint8Array(60), // tightly packed row-major RGBA, no padding
  name: "Result"
}
```

Selection payloads use `pixelFormat: "coverage8"`, one byte per logical pixel,
with the same rect/byteLength/bytes fields. Mask payloads additionally accept:

| Field | Default | Meaning |
| --- | --- | --- |
| mode | `intersect` | `create` or `intersect` |
| outsideCoverage | 0 | Coverage byte outside the supplied rectangle |
| density | 255 | Existing Mask density, 0–255 |
| feather | 0 | Existing Mask feather radius, 0–256 |
| linked | true | Move mask with layer (internal `enabled`) |
| enabled | true | Apply mask (internal `isEnabled`) |

Bytes must be an ArrayBuffer, Uint8Array or Uint8ClampedArray backed by a normal
ArrayBuffer, with exactly the declared logical length. Shared buffers are rejected.
All retained data is copied; no Document, Layer, native access, path, credentials,
network transport or model objects are exposed. See the **Hello World** example's
second button and `exact-result.js` for a working client.

## Identity, freshness and lifecycle

Document IDs identify actual open Document sessions; closing invalidates the
session, including if that same object is later reopened. Identical filenames
are unrelated. Layer IDs are opaque runtime identities bound to actual layer
objects. Imported PSD `lyid` values can be missing or duplicated; they do not
identify API targets. New raster layers get a unique valid PSD ID and advance the
normal resource counter. Runtime IDs are never persisted in PSD.

Target preparation captures the document object/session, layer object, canvas,
layer stack, history entry identities, and relevant state. Selection/mask writes
compare copied coverage. Mask writes compare every source pixel, raster-mask
coverage and parameters, and vector-mask state. History index alone is never
used as revision authority. Tab switches cannot redirect a result. Stack changes
(including reorder), deleted/replaced targets, changed geometry/history, source
pixels or masks cause conservative rejection and require fresh preparation.
This is bounded M0 validation, not the global mutation-epoch system of M1.

Writes require a host-registered live plugin iframe plus its current session.
A load event or DOM removal revokes its session and pending target. Reattaching
or reloading needs a new capabilities handshake. The sandbox remains unchanged.
Sequence validation prevents replay with bounded bookkeeping. This is an additive
boundary: it is not a security redesign of arbitrary legacy scripting.

### Existing sender inventory and compatibility

- `examples/plugins/hello-panel/panel.js` posts plain action-script strings and
  receives `app.echoToOE` status. This remains operational beside the new button.
- PluginPanel forwards host `done`/status messages to plugin frames.
- The shell accepts ArrayBuffer file-open messages and plain script strings;
  embed-host replies use `postClipboardEmbedMessage`/`window.parent.postMessage`.
- Font and filter workers use separate worker message channels.
- Scripting host bindings do not add native/network access for this milestone.

The two legacy shell branches do not authenticate sender identity uniformly with
structured requests. They are preserved exactly; tightening those flows needs a
separate sender-registration/compatibility change, outside M0. An existing
malformed-file limitation was also observed during testing: an unrecognized raw
ArrayBuffer can reach `getFormat(undefined)` and throw. Recognized file messages
are covered and preserved; this unrelated legacy error handling was not changed.

## Allocation and commit boundaries

`result-contract.js` centralizes provisional M0 limits: 16,384 per dimension,
24,000,000 pixels, 96,000,000 payload bytes, coordinates and rectangle endpoints
within ±1,000,000, feather ≤256, and names ≤255 characters. Safe integer products,
logical byte lengths, mask expansion/combination bounds and target allocations
are checked before copying/allocating large buffers. These are bounded engineering
limits, not measured hardware support claims; revisit with M1/M2 measurements.
Several snapshots and render copies may coexist, so payload limits are not a
claim about peak RAM. One pending target is retained per plugin session.

The internal path is `captureResultTarget → prepareExactResult → commitExactResult`.
Validation and full preparation happen before mutation. Commit revalidates the
captured target, applies the bounded change, pushes one HistoryEntry, checks
postconditions and then reports success. Failure restores the affected document,
layer and history state. This does not change `suspendHistory` or provide a generic
transaction manager. Undo/redo runs through the ordinary History tracker, using
private copied snapshots and fresh live copies; it never uses current selection,
a plugin, an external backend or model inference to recreate results.

PSD persists ordinary raster pixels and masks with existing serializers. Live
selection, runtime identities, pending results and history remain session state.
Automated self-round-trips cover pixels, coordinates and raster/vector masks;
this is not evidence of Photoshop or cross-platform interoperability.

## Milestone validation record — 2026-09-27

Starting checkout: `codex/modernization-roadmap` at
`be4f9e6a8f288f6ff27b7eea8481b69918698fcc`, also verified as fork `main`.
Implementation branch: `codex/m0-exact-result-transactions`.
The pre-existing untracked `docs/modernization-roadmap.md` was read and preserved
unchanged, and is not included in the implementation commit.

Validation uses 61 new tests across the result-transaction and plugin-session
suites. Coverage includes exact 3×5 bytes/padding, negative origins, open groups,
duplicate names and imported IDs, later ordinary layer ID allocation, full/zero/
soft selection, existing feather/density/outside values, vector coexistence,
unsupported/locked targets, source preservation, nested insertion-plus-mask
history replay, partial commit failure, failed postconditions, stale documents/
layers/pixels, tab changes, frame reload/removal, sequence/target replay,
legacy scripts/file routing, real PNG encoding, and the example client driving
the real transaction API. PSD self-round-trips use the real writer/parser.

| Lane | Result |
| --- | --- |
| `npm test` | 1,780 passed, 0 failed, cancelled or skipped; 422 suites |
| `npm run lint` | Passed |
| `npm run verify` | All eight checks passed; zero non-vendor import cycles |
| `git diff --check` | Passed |
| Rust tests | Not applicable: no Rust code changed |
| Native launch (`npm run dev`) | Blocked: Cargo executable unavailable; no toolchain installed |
| Browser smoke (`http://127.0.0.1:8765/`) | Frontend loaded, a 200×200 raster document was created, and the new Layer menu label rendered. System-font initialization warned because the Tauri bridge is absent. In-app browser coordinate mapping prevented reliable completion of the mask interaction. Temporary tab/server closed. |
| Manual native mask/undo/redo/save/reopen/plugin flow | Not verified |
| Cross-platform, packaged app, Photoshop interoperability, hosted CI | Not tested or claimed |

All editor behavior assertions above are automated integration evidence, not
claims of native visual acceptance. No M1 work, model/runtime, downloads,
provider, queue, preview framework, native bridge, dependency update, release,
push, tag or merge was introduced.
