# M9 — capability-based AI providers

M9 preserves the v0.10.1 product behavior. Remove, Fill, Expand and Upscale now
submit capability-specific detached pixels through `AIProviderRegistry` into the
existing `ModernizationJobs` service. ComfyUI remains the only shipping external
provider. There is no provider picker, new model, downloader, fallback, new job
system or arbitrary network extension.

## Terminology and routing

- **Capability:** an operation with an explicit input/output pixel contract.
  Existing M1 operation identifiers are retained for compatibility.
- **Provider:** an application-registered implementation of some capabilities.
  `comfyui-local` declares four independent handlers; it need not implement all
  capabilities.
- **Selection:** `{providerId, configuration}`. Configuration is provider-owned
  primitive metadata, validated and copied into an immutable resolution.
- **Binding:** an explicit capability → provider ID mapping at the composition
  root. A missing binding/provider or unsupported capability is an error, never
  an invitation to select another provider.
- **Profile:** informational model/workflow/effective-setting identity supplied
  by the provider. It is neither executable workflow JSON nor document authority.
- **Port:** a stateless adapter to M1's existing
  `validateInput/start/copyResult/disposeResult` interface. It is not a scheduler.

| Capability | Current contract | Local provider |
| --- | --- | --- |
| `ai-remove` | Logical ROI, copied RGBA8, mask, u32 seed → exact ROI RGBA8 | Original M2 SD1.5 workflow and fixed conditioning |
| `generate.fill` | Same plus bounded unchanged prompt → exact ROI RGBA8 | Original M6 SD1.5 workflow; 1–3 sequential M1 candidates |
| `generate.expand` | Expanded logical ROI, context pixels/mask/seed/prompt → exact expanded RGBA8 | Original M8 workflow; one candidate |
| `enhance.upscale` | Copied RGBA8, width/height, native scale → full RGBA8 dimensions/bytes | Original Real-ESRGAN general x4v3, 4× |
| `edit.instruction` | Reserved; no shipping contract or handler | Unsupported |
| `edit.reference` | Reserved; no shipping contract or handler | Unsupported |

Alpha/transparency and masks are explicit support declarations on each handler,
not model-name tests or mandatory operations. The current provider accepts RGBA
via the established RGB adaptations. It declares `nativeAlpha: false`. Original
selection coverage/exterior containment remains feature authority; Upscale
restores source alpha separately. No native RGBA generation is claimed. Quick
Select, BiRefNet and SAM2 remain separate providers in M1.

`discover()` returns immutable capability/support declarations without I/O.
`resolve()` validates registration, support, configuration and (when supplied)
input eligibility and returns the active profile. `inspect()` returns either that
resolution or its deterministic error/reason. Availability starts `unchecked`.
`check()` performs explicit readiness I/O and returns `available`, or propagates
the setup/service error. It uploads no pixels and does not authorize future work.
Execution still performs the existing Rust preflight; readiness is never cached.

## Before and after

Previously, feature orchestration constructed ComfyUI ports directly, dialogs
called backend-specific preflights, feature preparation supplied SD1.5-padded
working pixels, and Fill recipe construction embedded sampler/workflow/model
details. Masked and Upscale ports duplicated JS polling/cancellation lifetimes.

Now, the composition root (`ai-providers.js`) registers capability handlers.
Features create logical, unpadded snapshots and submit registry requests.
`comfy-pixels.js` supplies the unchanged 512/minimum/multiple-of-eight padding;
the provider crops decoded results back to explicit logical coordinates. The
shared `comfy-request.js` owns UUID, status polling, AbortSignal listener and
settlement cleanup. Late status cannot overwrite Upscale's local transparency
assembly. Backend configuration and identifiers live in `comfy-config.js` and
the existing backend/Rust implementations.

Legacy private workload/transport exports and positional provider injection
remain compatibility shims. They reuse the same preparation/transport helpers;
production UI and feature execution use neutral snapshots and registry ports.
The replacement-provider integration tests exercise those actual feature paths,
without ComfyUI padding or configuration fields in the provider input.

## Ownership and safety

| Owner | Responsibility |
| --- | --- |
| Feature/editor adapter | Document eligibility; captured document/layer/selection/history/source; original coverage or geometry; transient presentation; explicit Accept; exact commit/normal document creation |
| Registry | Immutable registrations/bindings; deterministic capability/configuration/input resolution; request selection; normalized copied output contract |
| M1 | One active execution, bounded queue/results/summaries; primitive/byte copies; session revisions; cancellation/revalidation/close; retained previews; terminal adapter disposal; late raw output disposal |
| Provider handler | Only copied pixel input and validated primitive configuration; execution preparation; detached result; cooperative targeted stop; optional raw-result disposal |
| Shared Comfy request | Fresh owned request UUID; progress polling; repeat targeted cancellation when Rust registration races; timer/listener cleanup at settlement |
| Existing Rust Comfy transport | One shared lease; literal loopback endpoint validation; no proxy/redirect; binary/JSON/PNG bounds; exact model/node/graph/job/output identity; targeted cancellation; lease release |
| M0 / ordinary loader and history | Sole permanent-edit authority. Remove/Fill insert a raster, Expand commits canvas-plus-raster atomically, Upscale opens a new unsaved ordinary document. Undo/Redo never infer. |

Every queued request pins a validated copied configuration. Fill also pins its
resolution across candidate creation and Regenerate, so changing the caller's
selection/settings cannot retarget later candidates or change provenance.
No provider gets a Document, Layer, adapter, DOM, history or transaction object.
Input fields are explicit; unknown model/transport/editor fields are rejected.
Output copies whitelist raster fields and finite named optional Upscale timings.

M1 is unchanged. Cancel/stale/close revoke acceptance immediately; the execution
slot remains owned until actual settlement. Providers' late/duplicate output is
disposed and cannot publish a preview or commit. Cross-document authority remains
in captured adapters. Terminal paths clear input/result/context/session references,
preview canvases/thumbnails and unused Fill candidates. Registry ports retain no
request-specific state or pixels. Padding adds at most 5 MiB of temporary masked
provider input for the single active execution, separate from M1's input budget.
Existing feature/candidate/geometry bounds remain unchanged; this is not a total
process/GPU memory cap.

## Settings and security compatibility

No persisted migration or schema/version bump is needed. The settings adapter
reads the existing `localInpainting`, `generativeCheckpoint` and privacy keys
without writing them or testing a connection. Remove retains its enable flag and
exact checkpoint. Fill/Expand retain the separate reviewed generation checkpoint
and shared endpoint, independent of Remove's enable flag. Upscale retains the
same endpoint and fixed reviewed Real-ESRGAN model, independent of Remove's model.
Existing defaults, trailing slash/port spelling and invalid saved values are
preserved; invalid configurations fail instead of being repaired or reinterpreted.
Explicit preference saves retain their existing keys and behavior.

Rust code and its security policy are unchanged. Endpoints remain exactly
`http://127.0.0.1:PORT` or `http://[::1]:PORT`, optionally one trailing slash.
No DNS, hostnames, cloud destinations, proxy routing, redirects, automatic retry
after ambiguous submission, global interrupt, model fallback, arbitrary graph
import or downloads are introduced. Output paths and workflow ownership still
undergo independent Rust verification. The external service's retention/network
behavior remains outside PhotoSuite's authority.

Fill profiles feed the unchanged passive recipe-v1 whitelist/privacy behavior.
PSD/PSB still contain ordinary rasters, geometry and optional informational XMP.
Opening, saving, Undo/Redo and recipe inspection never resolve/run a provider.

## Adding a future provider / M10 readiness review

1. Implement only the intended capability handlers in a new provider module.
   Declare a unique ID, display label and honest masks/alpha/scale support.
2. Supply `configure` (validate/copy settings), `describe` (passive profile),
   `check` (explicit readiness), optional provider input-eligibility validation,
   and `start(input, configuration, callbacks, identity)` for each capability.
3. Register it and explicitly change the relevant binding/selection in the
   composition/settings root. Preserve existing saved choices with a reviewed
   migration; never silently enable it or substitute it on failure.
4. Adapt the capability's **logical** pixel snapshot to its working resolution,
   runtime and transport entirely inside the handler. Return the existing exact
   logical RGBA8 output. Keep feature containment and Accept authority intact.
5. Honor M1's AbortSignal and return its cooperative stop function: `true` only
   when execution has actually stopped; otherwise report eventual complete/fail.
   Clean up timers/runtime resources and provide `disposeResult` when needed.
6. Validate/copy outputs using the capability contract. Retain no editor objects,
   pixel/result cache or second job queue. New native transport commands must
   independently validate their own fixed input/identity/security boundaries.
7. Test unsupported/input/configuration/readiness/failure cases, immutable routing,
   stale/cancel/late output/terminal cleanup, and the actual production feature
   adapters, history and PSD/PSB; then test the real runtime natively.

**M10 answer:** a modern provider for existing Fill/Expand/Remove can replace
working-resolution/model/graph execution behind these ports, without changing
M0, M1, feature preview state or document/history authority. This is supported by
an executed replacement-provider integration test for all four features; actual
FLUX compatibility remains unverified and is not claimed.

Remaining seams: M10 must review model rights/runtime/hardware/transport security
and implement its graph/profile/configuration. Recipe v1 intentionally recognizes
only the reviewed M6 ComfyUI workflow; a modern provider needs a separately
reviewed passive metadata schema (or accepts pixels without supported provenance).
It does not require transaction/history changes. New instruction/reference
capabilities require their own explicit contracts and future UI. Larger working
regions, expanded input classes, different scales, native alpha and raised
geometry/candidate limits belong to M10+ milestones, with new acceptance evidence.
The current SD1.5 and Real-ESRGAN model choices/quality limitations remain intact.

See [implementation trace](implementation-plan.md) and [acceptance](acceptance.md).
