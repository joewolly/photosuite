# Outpainting quality: bounded v1 evidence

Sixteen correlated probes ran through the production Rust M2 transport, fixed `photosuite-generative-expand-v1` operation, ComfyUI0.37.4 and the existing reviewed SD1.5 inpainting checkpoint. All used seed42 and mandatory preview. All16 completed; all16 final editor results had **zero changed bytes inside the mapped original image**, exact original layer buffers, exact Undo/Redo, and exact PSD/PSB layer/recomposition round trips.

These correctness results do not measure photographic realism. Landscape, flat, perspective and brick probes are synthetic. Four independent inherited public-domain/CC0 photographic sources cover portrait, people/architecture, cat and coffee/tabletop. The transparent bottle is an inherited synthetic alpha probe. This is a small correlated corpus, not a broad photographic benchmark. Prompts, source attribution, geometry, input hashes, masks, raw outputs and contained previews are retained in the external corpus.

Visual review of source/result comparison sheets:

| Case | Judgment | Observed result / limitation |
| --- | --- | --- |
| Landscape left | Useful, synthetic | Continues sky and grass; does not invent convincing new terrain detail. |
| Landscape right | Useful, synthetic | Continues broad flat regions; the path becomes a flat strip. |
| Ground bottom | Useful, synthetic | Extends the simple ground color; little new structure. |
| Empty prompt | Useful, synthetic | Contextual flat continuation without prompt rewriting. |
| Four sides | Useful, synthetic | Maintains broad sky/ground layout; visible simplification at mountain flanks. |
| Flat background | Useful | Close color continuation with a mild boundary difference. |
| Architecture | Mixed | Plausible additional column/background; perspective and ground edges soften. |
| Portrait headroom | Mixed | Added ceiling/background is usable; flag/background fragments near edge. |
| Repeated texture | Mixed | Brick colors/pattern continue; mortar/brick alignment is imperfect. |
| Sky top | Mixed | Sky matches broadly; cloud appears as a clipped white corner. |
| Explicit cloud prompt | Mixed | Weak adherence: clipped corner cloud, not a convincing cloud field. |
| Two sides / tabletop | Mixed | Recognizable wood continuation; brightness/texture seams and fragments. |
| Full-body surroundings | Failure | Bottom extension contains obvious vertical streaks; geometry looks stretched. |
| Perspective lines | Failure | Extended lines flatten horizontally instead of continuing perspective. |
| Canvas-edge cat | Failure | Repeated blurry bands at the edge, not a natural scene continuation. |
| Transparent image | Failure | Opaque white exterior is a poor continuation; requested blue background is not convincing. Original alpha remains exact. |

The six useful simple continuations justify a deliberately narrow, preview-required capability. Mixed cases require user judgment; four clear failures must be discarded. There is no claim of general photographic landscape quality, reliable perspective reconstruction, alpha-aware scene completion or strong prompt adherence. No new checkpoint is justified by this limited evidence.

The inference mask includes16 pixels of overlap, but the editor accepts **zero** overlap pixels. This guarantees the protected content, while exposing any model seam mismatch. No inside-border blending is silently accepted. Padding that repeats original edge context can also bias the model toward repetitive bands. Original image resizing never occurs.

Reproduce with `scripts/m8/create-corpus.py`, `prepare-corpus.mjs`, the opt-in Rust `real_expand_corpus` test, `contain-corpus.mjs`, and `render-corpus.py`. The raw evidence directory is `/Users/joe/Documents/Codex/2026-09-28/photosuite-m8-acceptance/corpus/`. Small comparison copies and receipts accompany this report.
