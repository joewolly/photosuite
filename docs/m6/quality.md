# M6 model gate and quality evaluation

## Decision

Retain the reviewed Stable Diffusion v1.5 Inpainting checkpoint for a **bounded, explicitly reviewed preview workflow**. Actual object replacement, clothing appearance changes, reconstruction and multiple distinct seeds work on the tested M5 machine through stock nodes. This is an acceptance of a useful optional editing tool with substantial quality limitations, not acceptance of every prompt or corpus image as successful.

It was not selected solely because M2 already used it: 17 real executions were evaluated for prompt adherence, structure, blending, transparency and context containment. The [SDXL 1.0 inpainting model card](https://huggingface.co/diffusers/stable-diffusion-xl-1.0-inpainting-0.1) was also reviewed: it describes a 1024-resolution, larger model under OpenRAIL++. SDXL was not downloaded or benchmarked here. There is no evidence in this evaluation that another checkpoint is materially better on this machine, and no comparative superiority claim. SD1.5 retains a known-provenance user-managed artifact, stock-node compatibility and modest typical 512-square runtime. Its poor small-region/flat-scene adherence is a genuine cost.

## Corpus observations

Manual evaluation of the actual output and editor-contained result, not synthetic service output. These correlated probes are deliberately small and are not a statistical benchmark. Source provenance and exact prompts/seeds/selections are in [`tests/fixtures/generative-corpus/v1/manifest.json`](../../tests/fixtures/generative-corpus/v1/manifest.json). Photos are inherited public-domain/CC0 M3 fixtures; geometric selections and original synthetic scenes are CC0. No endorsement by depicted people is implied.

| Case | Observed quality / failure |
| --- | --- |
| [Context-free](comparisons/context-free-comparison.jpg) | Reconstructed a plausible cup; empty prompt did not remove it. Contextual reconstruction is not an object-removal guarantee. |
| [Cup A](comparisons/replace-cup-comparison.jpg), [B](comparisons/replace-cup-b-comparison.jpg), [C](comparisons/replace-cup-c-comparison.jpg) | Blue ceramic replacement and distinct forms. Handles/latte details distorted in some seeds. Hard rectangle edges remain visible. All three raw and contained hashes differ. |
| [Material](comparisons/material-comparison.jpg) | Failed wooden-bottle instruction; erased content toward a plain patch. |
| [Add object](comparisons/add-object-comparison.jpg) | Failed red-mug instruction on the flat synthetic scene; largely blank rectangular fill. |
| [Clothing](comparisons/clothing-comparison.jpg) | Local red jacket-like change, with imperfect garment/body structure inside selection. Unselected face remained byte-exact. No face reconstruction quality claim. |
| [Fur adjacent](comparisons/fur-adjacent-comparison.jpg) | Grass instruction poorly followed; altered fur/context inside lasso. Outside fur remains protected. |
| [Architecture](comparisons/architecture-comparison.jpg) | Plausible localized column/background reconstruction; not reliable geometric restoration. |
| [Textured](comparisons/textured-comparison.jpg) | Plausible local wood texture with relatively subtle change and softer transition. |
| [Flat remove](comparisons/flat-remove-comparison.jpg) | Circle removed, but a conspicuous rectangular tone mismatch. No blur added to conceal it. |
| [Small](comparisons/small-comparison.jpg) | Tiny selected area failed to become a recognizable red flower. |
| [Large](comparisons/large-comparison.jpg) | Plausible bowl of oranges, stronger adherence than small/flat probes. |
| [Canvas edge](comparisons/canvas-edge-comparison.jpg) | Leaves instruction poorly followed; boundary placement and exclusion still exact. |
| [Transparent](comparisons/transparent-comparison.jpg) | Flower-like content generated with opaque/light background inside selection. The model does not infer alpha; selected transparent areas may become filled. |
| [Soft](comparisons/soft-comparison.jpg) | Blue cup modification with original feathered coverage giving a smoother transition. |
| [Text/logo](comparisons/text-logo-comparison.jpg) | Failed requested mug/text. Not suitable for exact typography/logos. |

Every comparison shows source, authority selection, raw model output, and final editor composite. The raw model can change context. The accepted composition measured **0 changed RGBA bytes outside nonzero original coverage in all 17 cases**. Soft coverage is retained as result alpha; excluded transparent RGB is also protected. This is a safety result, independent of whether the generated content looks good.

[Containment receipts](containment-receipts.json) record raw/source/patch/composite SHA-256, ROI, changed-byte counts and actual adapter timing. [Real receipts](real-receipts.json) record backend UUID, dimensions, seeds and total production Rust transport time. Local retained evidence also contains original RGBA, selections, model input, raw output, contained patch/composite and PNGs.

A 1024-square maximum-size native run additionally measures resource behavior. SD1.5 is trained around 512-pixel content: support for larger bounded inputs does not imply superior quality. Large selections can produce repetition and distorted structure, and are considerably slower on this machine.
