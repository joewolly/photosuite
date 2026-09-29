# M8 — bounded Generative Expand

Choose **Image → Generative Expand…**. Enter added left/top/right/bottom pixels, an optional prompt and an optional seed. Check the backend, then Generate. Review the larger image in the job strip; the cyan rectangle marks the protected old image. Accept changes canvas geometry and adds an ordinary exterior raster layer in one history entry. Discard/Cancel leaves the original document unchanged.

## Supported documents

V1 accepts RGB8 raster documents with 1–64 layer/group entries. Raster layers use Normal blending; groups use Normal or Pass Through. Multiple layers, negative/off-canvas raster bounds, raster alpha, zero-feather raster masks, and ordinary guides are supported. Source raster layer buffers, raster mask buffers, and unique retained `doc.resources` backing buffers share one aggregate 16 MiB budget. Each resource backing buffer counts at its full size, including storage outside a view; shared or overlapping resource views count that backing storage once, matching what M8 clones and preserves. Raster bounds are at most 4096 per axis, with origins within ±8192. All layers move by the same integer offset, including locked layers as in the existing canvas-resize behavior.

Deselect before expansion; selections do not define the generation region. V1 rejects artboards, document paths, vector masks/shapes, text, Smart Objects/linked assets, adjustment/fill layers, effects, clipping, knockout/channel blending overrides, special PSD Background layers, layer comps, indexed/high-depth/non-RGB documents, alpha/extra channels, and slices. Unsupported geometry fails before inference. Ordinary imported image layers named “Background” are supported; the special PSD background-layer flag is excluded. No rasterization or approximation of unsupported objects is performed.

## Geometry and containment

For old dimensions W×H and nonnegative added pixels L,T,R,B, the result is (W+L+R)×(H+T+B). Old pixel (x,y) maps to (x+L,y+T). One immutable geometry record supplies this mapping to preparation, preview, and acceptance. Existing `resizeDocumentCanvas` performs the translation on detached layers; M8 does not introduce a parallel canvas model.

The copied rendered composite is placed exactly at (L,T). Exterior pixels use edge-replicated context. The inference mask covers the exterior plus a **16-pixel overlap inside only the expanded edges**. Model padding repeats edge context on the right/bottom, to at least 512 and multiples of eight; padding mask is zero. The generation ROI is the whole expanded document and is distinct from model padding.

Inference overlap confers no editor authority. The accepted raster is a full expanded-canvas layer, **RGBA zero throughout the entire old image rectangle**, opaque in the exterior. Thus original transparent pixels remain transparent, original layer buffers are unchanged, and old off-canvas content cannot cover generated exterior pixels. No seam blend is accepted inside the old image. Detached composition verifies every byte in the mapped old rectangle before committing. This strict policy can leave visible seams when model context differs from protected pixels.

## Shipping limits

| Resource | Bound |
| --- | --- |
| Old and final document | 1024 per axis; final ≤1,048,576 pixels / 4 MiB RGBA |
| Added pixels per side | 0–512 integers; at least one added pixel |
| Exterior area | ≤786,432 pixels |
| Generation ROI / model | Whole expanded canvas / ≤1024², with independent model padding |
| Raw upload | ≤5 MiB (RGBA + mask) |
| Source raster layer + raster mask buffers + unique retained resource backing storage | ≤16 MiB aggregate; ≤64 layer/group entries |
| Geometry metadata | ≤1,048,576 UTF-16 units (up to 2 MiB JS string storage) |
| Candidates | One, ≤4 MiB; no parallel generation |
| Preview | ≤4 MiB RGBA + ≤4 MiB canvas backing |
| Prompt | Existing M6 validation: 1024 UTF-16 units / 2048 UTF-8 bytes |
| Seed | Existing M6 unsigned 32-bit seed; blank chooses random |

Session pixel and resource backing storage is conservatively bounded by source raster/mask/resource snapshots16 + copied original composite4 + prepared input5 + M1-owned input copy5 + result4 + preview4 + preview canvas4 = **42 MiB**. The source snapshot allowance includes the unique retained resource backing buffers within the same 16 MiB budget. The seed-display callback retains the prepared input until session disposal; the M1 input copy is released before preview. This sum deliberately counts both. Transport raw buffers, copied results, encoding, detached acceptance snapshots, caches and history are additional temporary allocations. Acceptance retains bounded before/after snapshots rather than backend outputs or workflow execution. The before/after raster/mask/resource snapshots together are at most 36 MiB plus the new four-byte layer-ID resource counter and up to 8 MiB of composites; installation and detached preparation temporarily add copies. These bounds are not total-process/RSS guarantees. Measurements are recorded separately in acceptance evidence.

One candidate is intentional: expanded previews and atomic snapshots cost more than M6 patch previews. V1 has no candidate switcher or session Regenerate button; discard and run again with the displayed effective seed if desired.

## Atomic history

Accept revalidates document identity, old geometry, exact source/composite/mask pixels, stack/hierarchy/metadata, guides, and the full history branch. It builds the translated layers and result on a detached document, verifies original projection, and prepares immutable replay snapshots. The live installation retains original layer identities (including M7 recipe associations). History finalization and geometry installation share one rollback boundary. Failure restores live layers, geometry, resources, caches, history, and flags. No standalone canvas-resize history entry is created.

Undo and Redo install retained PhotoSuite snapshots, without inference or network. New edits after Undo use the normal history branch rules. PSD/PSB store normal raster layers and dimensions, and work offline. For transparency, the PSD format's stored composite uses the existing white-matted RGB representation; exact editor appearance is verified by recompositing reopened layers, separately from source/result layer byte equality.

## Backend and privacy

M8 uses the existing numeric-loopback M2 transport, targeted owned-job cancellation, strict result identity/graph checking, and the reviewed M6 checkpoint. The fixed operation is `photosuite-generative-expand-v1`; the reviewed nine-node M6 graph/settings are reused. No arbitrary graph or sampler settings are accepted. See [M6 setup and license provenance](../m6/README.md) and [model hash](../m6/model-provenance.json). No model/backend/runtime is bundled or downloaded by PhotoSuite.

Empty prompt means contextual continuation. Prompt text is passed unchanged. ComfyUI may retain source uploads, outputs, prompt metadata and history. **M8 v1 does not persist a new generation recipe or prompt**: M7 schema1 explicitly recognizes only `generate.fill`, so no incompatible enum expansion is made. Existing M7 recipes/privacy behavior remains unchanged. Saved-file open does not run or probe a backend. Post-reopen Regenerate is unavailable.

Cancellation revokes Accept immediately and asks M2 to cancel the owned job. Late outputs are discarded; source close disposes preview authority; switching tabs cannot redirect the target. Backend unavailable errors leave geometry/history untouched.

M5a remains deferred. Artboard expansion, infinite canvas, panorama stitching, automatic composition, and semantic document regeneration are outside M8.

See [acceptance evidence](acceptance.md), [quality review](quality.md), and the [46-item completion report](completion-report.md). Empty PSD group markers may normalize from a four-byte in-memory placeholder to zero stored bytes; they have no raster pixels. Both representations are supported, and raster/mask pixels, geometry and composite are verified independently.
