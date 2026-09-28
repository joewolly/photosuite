# M5b quality evaluation

Versioned inputs and provenance: `tests/fixtures/upscale-corpus/v1/manifest.json`. Twelve probes include four inherited public-domain/CC0 photos, correlated derivatives and original synthetic CC0 artwork. This is a bounded diagnostic corpus, not a statistical quality benchmark or a ground-truth reconstruction test.

Comparisons use PhotoSuite's actual `rasterizeWithMatrix` nearest, bilinear and sharper modes at the same 4× dimensions, plus real model output with the defined alpha policy. “Sharper” is the existing implementation, not a claim that an independent bicubic library was tested. Each sheet shows an overview and a selected 1:1 output crop. JPEG sheets are for inspection; retained external PNG/raw outputs are lossless. No claim of universal improvement, perceptual score or faithful recovery follows from sharpness.

| Fixture / sheet | Observed result versus ordinary interpolation |
|---|---|
| [Natural photo](comparisons/photo-comparison.jpg) | Cup edges smoother/cleaner; wood and foam texture suppressed; specular details altered. Useful optional photographic treatment. |
| [Portrait](comparisons/portrait-comparison.jpg) | Less blocky edges, but waxier skin and changed eye/teeth detail. No face fidelity/restoration claim. |
| [Fur](comparisons/fur-comparison.jpg) | Crisp eye edges and invented directional fur strokes; natural texture becomes stylized. |
| [Architecture](comparisons/architecture-comparison.jpg) | Columns and garment boundaries sharper; small hands/clothing details reconstructed, not preserved. Large colors remain broadly similar by visual inspection. |
| [Text](comparisons/text-comparison.jpg) | Chosen labels remain recognizable, but stroke shapes/spacing change. Unsuitable for guaranteed exact text/logo content. |
| [UI](comparisons/ui-comparison.jpg) | Visible bright boundary halo; letters warp and thicken (e.g. Layers/Opacity). Standard interpolation is safer for faithful screenshots. |
| [Line art](comparisons/line-art-comparison.jpg) | Converging thin lines thicken, merge and warp. Failure for exact diagrams. |
| [Illustration](comparisons/illustration-comparison.jpg) | Jagged diagonal/circle smooth, but added bright/dark edge halos and gradients contaminate flat fills. |
| [Low JPEG](comparisons/jpeg-comparison.jpg) | Blocks/blur reduced strongly; cup contours cleaner, texture erased and highlights invented. Reconstruction is plausible, not known truth. |
| [Already sharp](comparisons/sharp-comparison.jpg) | Adds softness/contrast changes to exact stripes; no useful recovered detail. Nearest preserves intended geometry. |
| [Transparency](comparisons/transparent-comparison.jpg) | Hard, antialiased and partial-alpha regions retain independent coverage; no obvious matte fringe in inspected checkerboard crop. Model edge effects remain possible. |
| [Limit/tiling](comparisons/limit-comparison.jpg) | Exact 4096×2048 output; inspected join around source x=480 showed no obvious seam. Correlated photo derivative, used for memory/tiling acceptance. |

The selected official general model is practical, compact and fast on the tested MPS machine. It is accepted as an explicit optional new-document operation with review/discard, not as a default resize replacement. Small text/logos may change, and fine detail can be hallucinated.

## Reproduction

The fixture generator uses existing M3 corpus sources; inspect `scripts/m5b/create-corpus.py` for its PIL/font dependencies. Committed fixture PNGs/hashes are authoritative if font rasterization differs. Prepare raw files with `scripts/m5b/prepare-corpus.mjs`, then explicitly opt into the ignored Rust `real_upscale_corpus` test using `PHOTOSUITE_UPSCALE_CORPUS` and the reviewed local service. `scripts/m5b/compare.mjs` applies production alpha and existing interpolation; `render-comparison.py` writes lossless variants and comparison sheets. No live model or service is required by normal CI. See each script's arguments before running; keep large generated outputs outside the repository.
