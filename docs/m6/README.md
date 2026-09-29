# M6 Generative Fill

Select an area on the topmost ordinary raster layer, then choose **Edit → Generative Fill…**. Enter an optional prompt, choose 1–3 variations and optionally an integer seed. Check the backend, then Generate. The job strip shows progress and Cancel. When all candidates finish, A/B/C switches the transient preview; Accept adds exactly one ordinary **Generative Fill** raster layer. Discard leaves history untouched.

The eligible source is visible, Normal, fully opaque at the layer level, with no masks, clipping, effects, smart-object or text content. Its pixels may contain transparency. Source layers are preserved. Selection is required; an absent or empty selection never means “generate the whole canvas.” This is selected-region editing, not a text-to-image product.

## External setup and reviewed model

Use your own local **ComfyUI 0.37.4** installation. In **Edit → Preferences → Local AI Remove**, retain the existing numeric-loopback endpoint and set **Generative Fill checkpoint** separately from the AI Remove checkpoint and AI Upscale model. The reviewed filename is `sd-v1-5-inpainting.ckpt`. PhotoSuite neither downloads nor distributes this model, Python, ComfyUI or an additional inference runtime.

| Item | Reviewed identity |
| --- | --- |
| Checkpoint | Stable Diffusion v1.5 Inpainting, `sd-v1-5-inpainting.ckpt`, 4,265,437,280 bytes |
| Source | [stable-diffusion-v1-5/stable-diffusion-inpainting](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting), mirror of the deprecated Runway model, not affiliated with Runway |
| Revision | `8a4288a76071f7280aedbdb3253bdb9e9d5d84bb` |
| SHA-256 | `c6bbc15e3224e6973459ba78de4998b80b50112b0ae5b5c67113d56b4e366b19` |
| Checkpoint license | CreativeML OpenRAIL-M; [model card](https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-inpainting/blob/8a4288a76071f7280aedbdb3253bdb9e9d5d84bb/README.md), [linked upstream license](https://huggingface.co/spaces/CompVis/stable-diffusion-license), [retained text](MODEL-LICENSE.txt) |
| Backend | ComfyUI 0.37.4; exact verified source commit below |
| Workflow | `photosuite-generative-fill-v1`, fixed in `src-tauri/src/comfy.rs` |

Verified ComfyUI source commit: `8ff6dc384ba5c410266b40e137799e049459d4f2`. PhotoSuite and external ComfyUI are GPLv3; the checkpoint has its own license, including use restrictions. Framework licensing does not grant checkpoint rights. Local [provenance](model-provenance.json) records the independently verified artifact hash. No checkpoint conversion or redistribution occurred.

The nine-node graph uses eight stock node types: CheckpointLoaderSimple, LoadImage, LoadImageMask, CLIPTextEncode (positive and negative), InpaintModelConditioning, KSampler, VAEDecode, SaveImage. There are no custom nodes or new dependencies. Fixed settings: 20 steps, CFG 7, Euler, normal scheduler, denoise 1, noise mask enabled. Positive text is exactly the user prompt; negative text is empty. M2's original fixed positive/negative prompts remain unchanged.

Preflight checks the exact supported service version, required node input/output schemas, available checkpoint name and fixed output contract. It cannot establish checkpoint architecture or cryptographic identity from a filename. The user must verify the hash; a different model renamed to the accepted filename is not reviewed. Incompatible execution fails, with no fallback model. Arbitrary graph import, custom nodes and sampler controls are not exposed.

## Prompts, seeds and temporary recipes

Empty text requests contextual fill/reconstruction. It does not guarantee object removal. Nonempty text requests a replacement or modification; there is no automatic prompt rewrite. Text is bounded to 1,024 UTF-16 code units and 2,048 UTF-8 bytes, with malformed strings and control characters rejected (tab/newline/carriage return allowed). Unicode is accepted; the model's understanding is strongest for ordinary English prompts.

Each candidate records its effective unsigned 32-bit seed. A blank seed uses a cryptographic random value; variations increment it modulo 2³². Regenerate releases the old set and uses a fresh seed; Reuse seeds repeats the effective seeds. Neither promises identical output across machines, model revisions or backend/sampler versions.

Only a still-valid preview session can Regenerate. Prompt, model/workflow identity, settings, source/selection snapshots and seeds exist temporarily in memory. Accept, Discard, failure, stale source/selection, or document close ends the recipe and releases unused candidates. No prompt is used in a layer name or written as recipe metadata into PSD. M7 owns durable recipes.

Prompts and selected image context go only to the configured numeric-loopback backend. Redirects and proxy routing are disabled. **ComfyUI can retain uploads, prompts, generated PNG metadata and job history on disk.** PhotoSuite does not delete or control those external records. Local is not synonymous with ephemeral.

## Pixel authority and transparency

The nonzero selection bounds receive up to 64 pixels of context per side, clipped to the canvas. The rectangular ROI retains explicit document coordinates. Model padding extends right/bottom to at least 512 pixels and a multiple of 8; it repeats edge RGB and has zero generation mask. It never changes placement or canvas size.

The original coverage remains authoritative. A separate inference mask maps any nonzero coverage to 255; excluded/padded pixels remain 0. **Mask growth is zero.** No blur or dilation is added. Context and inference output outside the original selection confer no permission to change editor pixels.

The model sees source RGB flattened over white. The source RGBA buffer is preserved separately. The result is a generated RGB patch whose alpha is the original selection coverage; RGB is zeroed wherever final alpha is zero. Thus a selected transparent area can become opaque generated content, while all excluded RGBA pixels remain byte-identical. Soft coverage blends through normal raster alpha. The result uses baked alpha only, without a duplicate layer mask.

M1 previews this patch at the captured ROI without a history entry. Only explicit Accept invokes M0's existing exact raster transaction, creating one raster layer and one history entry. Undo/Redo and PSD rendering use stored pixels and work offline.

## Bounds and lifecycle

| Resource | Hard bound |
| --- | --- |
| Source layer and stored selection | ≤4,194,304 pixels, ≤8,192 per side |
| Document geometry | ≤32,768 per side; bounded source/selection still required |
| ROI and padded model | ≤1,024 per side, ≤1,048,576 pixels |
| Raw upload | ≤5 MiB RGBA plus mask; prompt metadata additionally bounded |
| Encoded source/mask PNG | Each ≤8 MiB; bounded JSON responses ≤2 MiB |
| Generated PNG / decoded result | ≤8 MiB / ≤4 MiB RGBA |
| Retained candidates | ≤3, sequential jobs, ≤12 MiB result pixels total |
| Thumbnails | None; zero thumbnail allocation |
| Active preview canvas | At most one, ≤4 MiB pixel backing; old canvas released on switch |
| Prompt | ≤1,024 UTF-16 units and ≤2,048 UTF-8 bytes |

These result limits are not a total-process memory promise. Three independent freshness contexts can retain up to 63 MiB (source16 + selection4 + ROI coverage1 MiB each); session input/coverage up to6 MiB, results12 MiB and active canvas4 MiB make up to85 MiB of retained pixel buffers, plus transient copies/encoding, editor history, browser and backend allocations. M1 also limits copied input to48 MiB, retained jobs to3 and queued jobs to2. Measured three-candidate 1024² acceptance is in [acceptance](acceptance.md).

Cancellation immediately revokes editor authority, then requests cancellation of the PhotoSuite-owned backend UUID. It never clears the global queue or interrupts another client. An aborted HTTP request does not prove GPU termination. New masked generation waits for the prior workload to settle. Source bytes, selection, geometry, document identity, history and target state are revalidated before preview, switching, Regenerate and Accept. Tab switching never redirects results; closing a document invalidates its old session, even if its filename is reopened.

See [quality findings](quality.md), [acceptance and measurements](acceptance.md), and [completion report](completion-report.md). M5a denoise remains deferred and is not a dependency. No M7/M8 features are included.
