# PhotoSuite AI Roadmap

> Living roadmap for PhotoSuite's AI editing track.
>
> **Baseline:** PhotoSuite v0.10.1  
> **Last updated:** 2026-09-30<br>
> **Current focus:** M10 — Modern local generation/editing model (NEXT; not started)

## Purpose

AI is a first-class PhotoSuite development track. The goal is not to bolt more isolated AI buttons onto the editor; it is to build a coherent local-first AI editing system that works naturally with selections, layers, masks, history, PSD/PSB persistence, and ordinary editing.

This roadmap is intentionally updateable. Model choices are **candidates, not permanent architecture decisions**. Re-evaluate model quality, licensing, hardware requirements, ComfyUI support, and maintainability at the start of each model-dependent milestone.

## Non-negotiable architecture

The M0–M8 transaction model remains the authority boundary:

```text
model / provider
      ↓
detached candidate
      ↓
preview
      ↓
explicit Accept
      ↓
exact PhotoSuite transaction
      ↓
ordinary document state
      ↓
Undo / Redo
```

AI providers must never mutate the active document directly.

Every AI feature must continue to preserve these rules:

- Preview and Discard do not create permanent document edits.
- Accept is explicit and atomic.
- Undo/Redo replays stored document state; it does not rerun inference.
- Cancellation, source edits, stale selections, closed documents, and superseded requests revoke acceptance.
- Providers receive only the inputs required for the requested operation.
- Local-first behavior remains the default product direction.
- Opening a PSD/PSB must never execute AI work automatically.
- Accepted AI results remain usable when the provider is unavailable.
- Model/provider-specific metadata must not become executable document state.

## Status legend

| Status | Meaning |
|---|---|
| **DONE** | Implemented, validated, and accepted |
| **NEXT** | Next milestone to design/implement |
| **PLANNED** | In roadmap, not started |
| **IN PROGRESS** | Active implementation |
| **BLOCKED** | Waiting on a dependency or unresolved decision |
| **DEFERRED** | Intentionally postponed |

## Roadmap at a glance

| Milestone | Status | Focus | Primary dependency |
|---|---|---|---|
| **M9** | **DONE** | Multi-model AI provider architecture | M0–M8 baseline |
| **M10** | **NEXT** | Modern local generation/editing model | M9 |
| **M11** | PLANNED | Instruction-based AI Edit | M10 |
| **M12** | PLANNED | Reference-image editing | M11 |
| **M13** | PLANNED | High-resolution region/context pipeline | M10–M12 |
| **M14** | PLANNED | Generative Fill + Expand modernization | M13 |
| **M15** | PLANNED | Background generation/replacement | M13–M14 |
| **M16** | PLANNED | AI object/text replacement workflows | M11–M14 |
| **M17** | PLANNED | Transparency and layer-aware AI workflows | M13–M16 |
| **M18** | PLANNED | Natural-language editor orchestration | M9–M17 |

---

# M9 — Multi-model AI provider architecture

**Status:** DONE

## Goal

Decouple PhotoSuite AI features from one specific model/workflow so future models can be added, upgraded, benchmarked, or removed without rewriting document transactions or UI state management.

## Scope

- Define stable provider capabilities rather than model-specific entry points.
- Separate provider configuration from feature behavior.
- Support capability discovery, such as:
  - inpaint / remove
  - instruction edit
  - generation
  - expand / outpaint
  - reference images
  - masks
  - transparency
  - upscale
- Keep ComfyUI as a provider implementation rather than the product-level API.
- Preserve the existing loopback-only security boundary for ComfyUI-backed providers unless a later decision explicitly changes it.
- Make provider/model selection explicit and inspectable.
- Add deterministic unsupported-capability handling.
- Keep current SD 1.5 and Real-ESRGAN workflows functional during migration.

## Non-goals

- No quality upgrade solely for M9.
- No automatic cloud fallback.
- No model download manager unless separately approved.
- No removal of existing exact-result transaction boundaries.

## Acceptance criteria

- [x] Existing M2/M5b/M6/M8 workflows run through the new provider abstraction.
- [x] Document/history behavior is byte-for-byte or semantically equivalent where exact bytes are not the existing contract.
- [x] Unsupported capabilities fail before provider execution.
- [x] Provider cancellation and stale-result behavior still satisfy M1 lifecycle rules.
- [x] Current local ComfyUI security restrictions remain enforced.
- [x] Tests cover provider selection, capability negotiation, cancellation, stale results, and provider failure.
- [x] No provider can directly modify PhotoSuite document state.
- [x] Migration is documented for future AI milestones.

## Final architecture and evidence

Features submit logical, capability-specific pixel snapshots to an immutable
`AIProviderRegistry`. Explicit bindings and copied validated configurations select
handlers; stateless ports reuse the existing M1 scheduler. The single shipping
`comfyui-local` provider owns model/workflow identity, working-resolution
adaptation and consolidated JS request/poll/cancel settlement. Existing Rust
transport/security and M0 document/history authority are unchanged.

Capabilities: `ai-remove`, `generate.fill`, `generate.expand`, `enhance.upscale`.
Instruction/reference edit identifiers are reserved and deterministically
unsupported. Masks/alpha/scales are support declarations per handler. Provider
selection, binding, profile, resolution and port terminology and the complete
extension procedure are defined in [M9 architecture](m9/README.md).

- Branch: `codex/m9-ai-provider-architecture`; local commits only, no PR/release.
- Actual starting main SHA: `4fcb483fc5eb911c80dccd071f59b6bf715b95af`.
- Implementation commit: `8c48d5154cfc9ed89ceff460be6767d52ad03edc`;
  completion report committed immediately afterward.
- JavaScript: 2,196 passed, zero failed/skipped; lint/static verification pass.
- Rust: locked check pass; 25 default tests pass plus all three opt-in real tests.
- Native Apple M5/macOS: four real ComfyUI workflows available/unavailable;
  exact containment/history; cancellation/stale/closure; pinned multi-candidate
  configuration; twelve unique PSD/PSB files reopened with backend stopped.
- Full evidence, limitations, file inventory and all fifteen completion criteria:
  [M9 acceptance](m9/acceptance.md).

M10 can replace execution behind existing capability ports without rewriting
transactions, lifecycle or feature authority. Actual FLUX compatibility is
unverified. Its graph/runtime/configuration/security/model-rights and quality
review remain future work. Recipe-v1 metadata intentionally retains the reviewed
ComfyUI whitelist; a new passive provenance schema, new instruction/reference
contracts/UI, native alpha, larger regions and changed limits require separate
acceptance. Current SD1.5/Real-ESRGAN choices, legacy settings and quality limits
remain unchanged; no fallback, downloads, cloud endpoints or new AI UI were added.

---

# M10 — Modern local generation/editing model

**Status:** NEXT

## Goal

Replace SD 1.5 as PhotoSuite's primary modern generative editing path while retaining it as a compatibility/fallback option if useful.

## Current candidate

**FLUX.2 [klein] 4B** is the current leading candidate because it combines generation and instruction-based editing with an open license suitable for an open-source application.

This is **not locked**. At milestone start, compare viable models on:

1. Edit fidelity.
2. Identity/content preservation.
3. Inpainting quality.
4. Prompt adherence.
5. Reference-image support.
6. Text rendering.
7. VRAM/RAM requirements.
8. Apple Silicon behavior.
9. NVIDIA behavior.
10. ComfyUI/native runtime maturity.
11. License and redistribution constraints.
12. Model size and provisioning burden.

## Scope

- Integrate the selected model through M9 provider interfaces.
- Define supported hardware tiers and graceful failure behavior.
- Add a repeatable image-edit quality suite.
- Compare the new engine against the existing SD 1.5 baseline.
- Preserve existing accepted-result semantics.

## Acceptance criteria

- [ ] Selected model/license is documented and reviewed.
- [ ] Quality suite demonstrates a material improvement over SD 1.5 on PhotoSuite use cases.
- [ ] Failure on unsupported hardware is clear and non-destructive.
- [ ] Cancellation leaves no document mutation.
- [ ] Preview/Accept/Undo/Redo remain exact at the PhotoSuite boundary.
- [ ] Existing PSD/PSB persistence remains unaffected.
- [ ] Performance and memory observations are recorded on representative hardware.

---

# M11 — Instruction-based AI Edit

**Status:** PLANNED

## Goal

Add a first-class **AI Edit** workflow that accepts natural-language editing instructions instead of forcing every task through a specialized Generative Fill prompt.

Examples:

- "Make the shirt blue."
- "Remove the car."
- "Change this chair to brown leather."
- "Make the scene nighttime."
- "Replace the table with white marble."

## Scope

- Prompt + current image/layer input.
- Optional selection/mask constraint.
- Detached preview candidates.
- Explicit Accept/Discard.
- Selection-authorized edits where applicable.
- Clear indication of what image context is being sent to the provider.
- Reuse ordinary PhotoSuite layers/history rather than creating a parallel AI document model.

## Acceptance criteria

- [ ] Works with and without an explicit selection where the provider supports both.
- [ ] Selected-region edits cannot silently modify unauthorized pixels when operating in constrained mode.
- [ ] Source changes invalidate stale previews.
- [ ] Undo/Redo never reruns inference.
- [ ] Representative color/material/object/removal edits pass the quality suite.

---

# M12 — Reference-image editing

**Status:** PLANNED

## Goal

Allow users to provide one or more reference images to guide an edit.

Examples:

- Put a photographed jacket on a person.
- Replace furniture using a product reference.
- Match material, texture, color, or visual identity from another image.
- Preserve a subject/product identity across edits.

## Scope

- Reference-image picker.
- References from open PhotoSuite documents and local files.
- Clear ordering/roles when a model supports multiple references.
- Bounded memory/input handling.
- References remain detached from document mutation unless explicitly inserted.

## Acceptance criteria

- [ ] Reference inputs are explicit and visible before generation.
- [ ] Closing/changing a reference invalidates dependent work when required.
- [ ] Multiple-reference limits are enforced.
- [ ] Identity/product-reference test cases are included in the quality suite.
- [ ] PSD/PSB save does not accidentally embed large reference payloads unless explicitly designed.

---

# M13 — High-resolution region/context pipeline

**Status:** PLANNED

## Goal

Remove the current assumption that AI generation dimensions must equal document dimensions.

Large documents should be editable by generating only the necessary working region plus surrounding visual context.

## Intended flow

```text
large document
    ↓
selection / target region
    ↓
bounded context crop + halo
    ↓
provider working resolution
    ↓
generated region
    ↓
validated composite
    ↓
exact PhotoSuite transaction
```

## Scope

- Context-region extraction.
- Configurable context halo.
- Resolution adaptation/downsample strategy.
- Mask/selection coordinate transforms.
- Seam-aware recomposition.
- Exact preservation outside authorized output bounds.
- Memory and history budgeting independent of full document size.

## Acceptance criteria

- [ ] AI edits work on documents substantially larger than current generation limits.
- [ ] Pixels outside the authorized edit region remain exact where the operation promises constrained editing.
- [ ] Coordinate transforms are deterministic and tested.
- [ ] Edge/seam quality is included in visual acceptance.
- [ ] History memory remains bounded and documented.
- [ ] Large-document failure never corrupts the source document.

---

# M14 — Generative Fill + Expand modernization

**Status:** PLANNED

## Goal

Move existing Generative Fill and Generative Expand onto the modern provider and high-resolution region pipeline.

## Scope

### Fill

- Modern model.
- Better semantic prompt adherence.
- Better context preservation.
- Reference-image support where useful.
- Continue supporting multiple candidates.

### Expand

- Remove the current 1024-per-axis architectural limitation where resource evidence supports doing so.
- Generate exterior regions using M13 context extraction.
- Preserve original interior pixels exactly.
- Improve seam handling and large-canvas behavior.

## Acceptance criteria

- [ ] Existing M6/M8 behavioral guarantees still pass.
- [ ] Quality is materially better than the v0.10.1 SD 1.5 baseline.
- [ ] Expand supports meaningfully larger real-world documents.
- [ ] Interior preservation remains exact.
- [ ] Memory/history costs are measured before limits are raised.

---

# M15 — Background generation and replacement

**Status:** PLANNED

## Goal

Turn subject selection/masking plus modern generation into a dedicated background workflow.

## Scope

- Generate background from prompt.
- Replace background while preserving foreground subject.
- Optional reference background/style image.
- Transparent-background starting point.
- Edge-aware subject integration.
- Preview variants before acceptance.

## Acceptance criteria

- [ ] Foreground preservation is measured and visually reviewed.
- [ ] Hair/fine-edge cases are included.
- [ ] Background replacement works with existing M3 subject masks.
- [ ] Accepted output remains ordinary editable document state.

---

# M16 — AI object and text replacement

**Status:** PLANNED

## Goal

Provide targeted replacement workflows beyond generic fill.

## Scope

- Object replacement with natural-language instruction.
- Reference-driven object replacement.
- Text/signage replacement where supported by the selected model.
- Geometry-aware constrained replacement.
- Preserve surrounding layout and content as much as possible.

## Acceptance criteria

- [ ] Object replacement suite covers product, furniture, clothing, and simple scene objects.
- [ ] Text replacement is only exposed when quality is good enough to be useful.
- [ ] Selection/mask boundaries remain authoritative in constrained mode.
- [ ] No claim of exact text fidelity unless validated.

---

# M17 — Transparency and layer-aware AI workflows

**Status:** PLANNED

## Goal

Make AI outputs behave more naturally inside a layer-based editor rather than treating every result as a flattened opaque rectangle.

## Scope

Candidate capabilities include:

- Native RGBA generation when a suitable provider supports it.
- Generate isolated objects onto transparent layers.
- Subject extraction + generated transparent result.
- Layer-aware context input.
- Generate into a new layer by default.
- Optional mask creation alongside generated pixels.

## Acceptance criteria

- [ ] Alpha handling is deterministic and tested.
- [ ] Transparent output round-trips through PSD/PSB within documented limits.
- [ ] AI results remain ordinary layers/masks.
- [ ] Layer-aware context never grants the provider authority to mutate source layers.

---

# M18 — Natural-language editor orchestration

**Status:** PLANNED

## Goal

Allow a user to describe a broader editing intent and have PhotoSuite propose/execute a sequence of existing editor operations and AI operations.

Example:

> "Remove the person on the right, darken the sky, and crop this vertically."

## Important distinction

M18 should **orchestrate PhotoSuite capabilities**, not give an LLM unrestricted document access.

The orchestrator proposes a bounded plan using known commands. Permanent edits still pass through normal PhotoSuite transactions and user-visible acceptance rules.

## Scope

- Natural-language command input.
- Structured plan generation.
- Allowed-command registry.
- Previewable multi-step plan.
- Per-step or grouped confirmation strategy.
- AI Edit as one tool among ordinary editor operations.
- Clear failure/recovery behavior.
- No arbitrary code execution.

## Acceptance criteria

- [ ] Orchestrator can only invoke explicitly registered operations.
- [ ] Plans are inspectable before destructive/permanent execution.
- [ ] Undo behavior is defined for multi-step operations.
- [ ] No unrestricted JavaScript/JSX execution through natural-language requests.
- [ ] Ambiguous instructions fail safely or request user choice.
- [ ] Existing exact-result boundaries remain authoritative for AI-generated pixels.

---

# Shared quality gates

Every model-dependent milestone should be evaluated against the same core suite.

## Edit fidelity

- Preserve unrelated content.
- Preserve subject identity where requested.
- Preserve perspective and geometry where requested.
- Respect masks/selections.
- Avoid unnecessary global restyling.

## Generation quality

- Prompt adherence.
- Fine detail.
- Human anatomy.
- Texture continuity.
- Lighting consistency.
- Text/signage when relevant.
- Seam quality for fill/expand.
- Reference-image adherence.

## Product behavior

- Cancel.
- Retry.
- Multiple candidates.
- Stale preview invalidation.
- Source edit invalidation.
- Cross-tab/document isolation.
- Close-document cancellation.
- Provider unavailable/offline behavior.
- Undo/Redo.
- Save/reopen.
- PSD/PSB persistence.

## Resource behavior

Record, at minimum:

- Model files and sizes.
- Peak host memory.
- Peak WebContent memory where applicable.
- GPU/VRAM use where measurable.
- Cold/warm latency.
- Working resolution.
- History memory retained after Accept.
- Cleanup/worker retirement behavior.

---

# Model and capability watchlist

This section is intentionally non-binding. Update it as the ecosystem changes.

| Candidate | Interest | Current roadmap role | Notes |
|---|---|---|---|
| **FLUX.2 [klein] 4B** | High | M10 leading candidate | Validate quality, runtime, memory, and license before commitment |
| **Qwen-Image family** | Watch | Optional/future provider | Re-check current model licensing before any bundled/default use |
| **SD 1.5 inpainting** | Legacy | Compatibility baseline | Current v0.10.1 Fill/Expand engine |
| **Real-ESRGAN** | Existing | Upscale | Keep until a replacement clearly improves the product |
| **SAM 2.1** | Existing | Object Selection | Already integrated; independent of generative engine |
| **BiRefNet-lite** | Existing | Select Subject/background | Already integrated; independent of generative engine |

When a milestone begins, add any new credible candidates and record why the final model was selected.

---

# Decision log

Use this table for decisions that should survive individual implementation threads.

| Date | Decision | Rationale | Revisit when |
|---|---|---|---|
| 2026-09-29 | AI becomes a first-class PhotoSuite development track. | Modern image editing increasingly depends on high-quality AI workflows; the classic editor foundation is already strong enough to support this focus. | Product direction changes materially |
| 2026-09-29 | Preserve the M0–M8 detached-preview / explicit-Accept transaction architecture. | It keeps model execution separate from document authority and preserves exact Undo/Redo semantics. | Only with evidence of a superior equally-safe model |
| 2026-09-29 | Build M9 before replacing SD 1.5. | Future model changes should not require another feature-specific architecture rewrite. | After M9 acceptance |
| 2026-09-29 | Treat FLUX.2 [klein] 4B as a candidate, not a permanent dependency. | Model quality and the open ecosystem move quickly. | M10 start |
| 2026-09-30 | Accept M9 capability registry, logical pixel contracts and explicit immutable provider selection; retain M1/M0 authority and current local ComfyUI security. | Replacing model execution no longer requires feature transport/padding or document/history changes. Unsupported operations and failures remain deterministic. | M10 provider and passive provenance review |
| 2026-09-30 | Preserve existing settings keys and current models; reserve instruction/reference capabilities without implementing them. | M9 changes architecture while retaining v0.10.1 behavior and limiting scope. | Separately accepted M10+ work |

---

# Milestone completion template

Copy this section into the milestone's implementation/acceptance document when work begins.

```markdown
## Completion record

- Status:
- Branch:
- Starting commit:
- Final commit:
- PR:
- Release:
- Provider/model:
- Model hash/version:
- ComfyUI/runtime version:
- Hardware tested:

### Validation

- JavaScript:
- Rust:
- Native macOS:
- Native Windows:
- Native Linux:
- PSD:
- PSB:
- Offline/no-provider:
- Cancellation/stale-result:
- Memory/performance:
- Quality suite:

### Known limitations

-

### Follow-ups

-
```

---

# Change log

| Date | Change |
|---|---|
| 2026-09-29 | Created AI roadmap for M9–M18. AI elevated to a first-class PhotoSuite development track. M9 marked NEXT. |
| 2026-09-30 | Completed M9 and marked M10 NEXT. Recorded provider terminology/ownership/extension decisions, native real-backend/offline acceptance, full validation and remaining M10 seams in docs/m9. No M10 work started. |
