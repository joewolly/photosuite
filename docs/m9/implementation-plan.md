# M9 implementation plan and baseline trace

Baseline: clean `main`, fast-forwarded from v0.10.1 `1e1421db` to
`4fcb483fc5eb911c80dccd071f59b6bf715b95af` (two roadmap-only commits).
Branch: `codex/m9-ai-provider-architecture`. No CodeGraph index exists.

Read before production edits: AI-ROADMAP, EXACT-RESULT-TRANSACTIONS,
M1-JOB-LIFECYCLE, M2 architecture/native acceptance, M3/M4 architecture,
M5b/M6/M7/M8 architecture/acceptance. The released source and milestone
contracts agree on the four migrated workflows. M6's early documentation says
recipes are transient; M7 subsequently adds passive, privacy-controlled XMP.

## Existing execution and authority

| Feature | Entry/configuration | Execution | Preview/Accept/persistence |
| --- | --- | --- | --- |
| Remove | UI dispatch reads `localInpainting`; `SelectionJobs.submitAI` | ROI/coverage snapshot; `createComfyProvider`; binary `comfy_inpaint`; fixed SD1.5 graph | Inpaint adapter constrains original coverage; M0 raster insertion; stored bytes/history/PSD |
| Fill | Dialog reads separate `generativeCheckpoint` and shared endpoint; `GenerativeSession` | 1–3 sequential M1 candidates; `createGenerativeProvider`; `comfy_generative` | Same inpaint adapter; chosen candidate only; M0 + passive M7 recipe; privacy-controlled PSD/PSB |
| Expand | Dialog reads generation configuration; `submitExpand` | Detached composite/geometry; `createExpandProvider`; `comfy_expand` | Expand adapter zeros old rectangle; M0 bounded canvas-plus-raster transaction; exact stored geometry/history/PSD/PSB |
| Upscale | Dialog constructs fixed Real-ESRGAN config using shared endpoint | Rendered composite; `createUpscaleProvider`; `comfy_upscale` | Separate thumbnail; Accept opens ordinary new unsaved raster document through existing loader; source history unchanged |

All use one `ModernizationJobs` scheduler. It copies primitive input, validates
before snapshots, owns queue/active slot/results, revokes immediately on cancel,
checks source before dispatch/publication/Accept, disposes terminal contexts,
rejects late output, supersedes session revisions, and cancels source closure.
Switching active document cannot redirect an adapter. Undo/Redo and reopen do
not call providers. Rust shares one `ComfyState` lease and `execute_graph` for
all workflows; no second Rust transport is needed.

Leaks: direct backend factories/preflights in feature bridge/dialogs; checkpoint
validation/model identifiers in workloads; SD1.5 padding in feature snapshots;
fixed workflow/model/sampler details in Fill recipe construction; duplicated JS
poll/cancel/settlement between masked and upscale transports. Rust workflows,
schema/identity/path checks are already correctly below the provider boundary.

## Bounded refactor

1. Add explicit capability contracts and immutable per-controller registry with
   deterministic binding/configuration/input resolution. Adapt registry ports to
   M1's existing validate/start/copy/dispose interface, without changing M1.
2. Register one reviewed local ComfyUI implementation with four independently
   declared capability handlers. Instruction/reference editing remain explicitly
   unsupported. Declare alpha handling as support data, not a model-name test.
3. Feature snapshots contain unpadded RGBA/mask/rect/seed/prompt or RGBA/size/scale.
   Provider pads/crops and normalizes output. Keep baseline bounds, context,
   overlap, seeds/prompts, candidate count and feature containment unchanged.
4. Move backend configuration/model/workflow constants into provider configuration;
   keep legacy settings keys and deterministic default values. UI resolves an
   opaque selection and asks the registry for explicit readiness, without cached
   availability or fallback. Backend settings pane remains backend-specific.
5. Share JS request identity/status/cancel cleanup. Keep existing Rust commands,
   loopback grammar, no proxies/redirects, binary bounds, graph/output identity,
   single lease and targeted cancellation untouched.
6. Fill consumes passive provider profile metadata for the existing recipe v1;
   no provider can receive a Document, adapter, DOM, history, or transaction.
7. Retain old workload/transport exports as compatibility helpers for existing
   callers/tests; production feature paths use registry/neutral contracts.

## Acceptance

Add registry/resolution/configuration/unsupported/failure/input tests, drive all
four real feature adapters through registry ports, exercise M1 lifecycle and
result ownership, preserve existing tests unchanged where possible. Run full JS,
lint/static/runtime staging verification, locked Rust check/tests, relevant real
service tests and actual native available/unavailable acceptance. Record evidence
lanes honestly. Review replacement-provider integration with no document/history
or scheduler changes; document passive recipe schema and baseline geometry limits
as remaining seams. Update roadmap only after acceptance; commit coherent changes
with clean tree, no push/merge/release or M10 implementation.
