# M2: local AI Remove

AI Remove is an optional producer of raster pixels. PhotoSuite sends a bounded crop and mask to a separately managed ComfyUI service, shows a transient M1 preview, and commits only an explicit Accept through M0. It does not install, launch, bundle, update or download the inference stack. Normal editing, startup, save, Undo/Redo and PSD reopen make no inference requests.

## Setup and supported scope

Use ComfyUI **0.37.0 or 0.37.4**, an SD 1.5 inpainting checkpoint containing its CLIP and VAE, and the built-in nodes listed below. These are exact validation targets, not a claim of compatibility with arbitrary versions, SDXL, Flux, custom nodes or arbitrary workflows. The relevant `server.py`, `nodes.py` and `comfy_execution/jobs.py` are identical between these two release tags. Native acceptance evidence is recorded separately in [m2-native-acceptance.md](m2-native-acceptance.md).

1. Start the local ComfyUI instance yourself and install your chosen compatible checkpoint into its checkpoints directory.
2. In PhotoSuite **Preferences → AI Remove**, enable local AI Remove, enter the loopback endpoint and exact checkpoint identifier, then save settings.
3. Use **Test Connection**. This checks version, required node signatures/connections/settings, upload capability, output node and checkpoint availability. It does not run inference or prove the contents/architecture of a checkpoint; successful generation establishes that compatibility. Missing requirements produce setup errors without installing or substituting anything.
4. Select the removal region on the topmost ordinary raster layer, then choose **Edit → AI Remove (local service)…**.
5. Wait for the preview, then Accept or Discard. Accept inserts one ordinary raster layer named **AI Remove** and one history operation.

The source must be visible, Normal, at full opacity/fill, without masks, clipping, layer effects, knockout, restricted channels, vector fill, text or Smart Object content. The initial source is that raster's pixels, not a flattened whole-document export. This narrow scope makes the transient overlay and inserted topmost raster agree without changing the compositor. Convert/prepare an appropriate raster manually when needed. Source pixels are preserved.

## Boundary and identity

`inpaint-workload.js` copies primitive pixels, mask, dimensions, seed, settings and an explicit coordinate mapping. `comfy-provider.js` is an M1 provider and never receives editor objects. Tauri carries RGBA8 plus mask as one binary request body (five bytes per model pixel); a bounded metadata header carries the UUID/configuration/dimensions/seed. Rust performs blocking HTTP work on `spawn_blocking`, then returns raw normalized RGBA8 through Tauri. No large byte arrays or base64 images enter JSON.

The endpoint is exactly `http://127.0.0.1:PORT` or `http://[::1]:PORT`, optionally with one trailing slash. Port must be 1–65535. Hostnames (including `localhost`), alternate IP spellings, credentials, paths, queries, fragments, HTTPS and non-loopback addresses are rejected. The client disables proxies and redirects. No DNS resolution or redirect can turn the configured local address into a remote destination. This limits PhotoSuite's destination; it cannot control network behavior inside the separately managed service or its extensions.

Each invocation receives a fresh UUID and owns only filenames prefixed `photosuite-<UUID>`. ComfyUI receives that UUID as `prompt_id`, an attributed `client_id`, and workflow/request metadata. Upload echoes, submission identity, polled job identity, completed graph and metadata, node 9's single output and its owned path are checked. Numeric JSON representations such as `7` and `7.0` compare by exact value; graph structure, links and all other values remain exact. Submission is never retried after ambiguous acknowledgement.

## Fixed workflow: photosuite-remove-v1

The literal graph is in `src-tauri/src/comfy.rs`. There is no workflow importer or editable graph. Its eight built-in node types form nine nodes:

| Node | Purpose |
| --- | --- |
| 1: CheckpointLoaderSimple | Exact configured checkpoint; model, CLIP, VAE |
| 2: LoadImage | Owned RGB source PNG |
| 3: LoadImageMask | Owned RGB mask PNG, red channel |
| 4/5: CLIPTextEncode | Fixed positive and negative conditioning |
| 6: InpaintModelConditioning | Source, mask, VAE, conditioning; noise mask enabled |
| 7: KSampler | Random retained u32 seed, 20 steps, CFG 7, Euler, normal scheduler, denoise 1 |
| 8: VAEDecode | Decode the generated latent |
| 9: SaveImage | One owned output PNG; IMAGE output socket |

Positive conditioning is `clean background, natural texture, seamless`; negative conditioning is `object, text, watermark`. The user cannot inject graph expressions, file paths, generation parameters or custom nodes. The explicit checkpoint identifier is the only model reference. A listed incompatible checkpoint may pass availability checks but fail generation; PhotoSuite reports that error and does not choose another model.

API references: [v0.37.4 server](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.4/server.py), [built-in nodes](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.4/nodes.py), [job normalization and cancellation](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.4/comfy_execution/jobs.py).

## Crop, mask and containment

Only nonzero selection coverage inside the canvas determines the removal bounds. Expand by **64 document pixels** on each side and clip to the canvas. Preserve the resulting `{x,y,width,height}` ROI explicitly. Reject unsupported bounds before allocating the model buffers.

Pad the model input on the right and bottom to at least 512 pixels per dimension and then a multiple of eight, without resampling. Edge image pixels repeat into padding; mask padding is zero. `modelOffset={x:0,y:0}` is explicit, and model padding is removed before preview. The transform is `(model x,y) → (x−offset.x,y−offset.y) → (ROI.x+x,ROI.y+y)`; output dimensions never determine placement.

Selection coverage remains **0 excluded / 255 included**. The built-in conditioning path rounds masks, so the inference mask explicitly converts **any nonzero coverage to 255 regenerate**, with zero meaning preserve. No dilation/growth is added. Soft original coverage is retained separately and becomes the result's alpha. Transparent source input is flattened over white for the RGB model input.

The editor adapter independently constrains every returned pixel: alpha equals original selection coverage, with transparent RGB zeroed. A model changing every context pixel still has no authority outside that selection. At zero coverage the original document composite remains byte-identical; partial coverage blends the generated color predictably over the preserved source. The output is an ordinary raster with coverage baked into alpha, not a special AI object or editable raster mask. M0's existing insert transaction does not atomically attach a mask; this milestone does not rewrite it.

## Lifecycle and failures

M1 owns queueing, preview, Cancel, Discard, freshness and resource release. Stage reports are Preparing, Uploading, Queued, Generating and Receiving result, followed by Ready; no elapsed-time percentages are invented. Only one AI Remove request/result may be retained, including a transport that is still stopping.

Freshness checks retain source bytes, selection bytes/bounds, source identity/metadata, document history and target identity. Changes are checked periodically, at completion and again at Accept. Document close cancels; switching tabs never transfers authority to another document. Preview uses the existing document tool-overlay surface and creates neither a layer nor history. Discard/cancellation releases the owned canvas and retained result.

Cancel immediately revokes acceptance in M1 and discards late output. Rust then attempts `POST /api/jobs/<owned UUID>/cancel`, which the pinned versions implement for queued and running jobs. It never calls global interrupt or clears a queue. A response acknowledges a cancellation attempt, not proof that a GPU has stopped. A request already blocked in HTTP can take up to its request timeout to settle. The single-flight lease remains held until transport settlement; errors after attempted submission also try targeted cancellation.

Connection failures, timeouts, HTTP errors, malformed/oversized responses, rejected workflows, server restart, wrong identities, missing/unowned output, unsupported format or invalid dimensions end the M1 job without document mutation. Errors remain visible and another job can run once settlement releases the slot. Results must be an exact-size, nonanimated, 8-bit RGB/RGBA PNG; Rust ignores metadata, normalizes RGB into opaque RGBA8, and the editor applies coverage.

## Limits and retention

| Resource | Bound |
| --- | --- |
| Source raster / selection scan | 4,194,304 pixels; each dimension ≤8192 |
| Document dimensions | ≤32768; selection may touch any edge/corner |
| Context | Fixed 64 pixels per side, clipped |
| ROI/model dimensions | ≤1024 each, ≤1,048,576 pixels |
| Binary model input | Exactly 5 bytes/pixel; at most 5 MiB |
| Normalized result / retained patch | At most 4 MiB each |
| HTTP JSON | 2 MiB per response |
| Encoded PNG / decoder budget | 8 MiB each |
| HTTP connect / complete request | 3 seconds / 15 seconds |
| Queue + generation deadline | 15 minutes |
| Retained AI request/preview | One, including cancelling transport |

These are per-buffer limits, not an RSS promise. Additional bounded copies include the source freshness snapshot (≤16 MiB), selection snapshot (≤4 MiB), coverage (≤1 MiB), M1 input/result copies, Tauri transfer copies, PNG codec buffers and a preview canvas. M1 retains its existing 48 MiB submitted-input budget and general queue limits. Native measurements are machine-specific.

PhotoSuite encodes in memory and creates no local transfer files. ComfyUI's upload/save APIs do write the uniquely named crops, masks and outputs in that service's directories and may retain history/PNG workflow metadata. The integration does not claim zero disk traces. The supported API has no scoped input/output deletion path used here; PhotoSuite deletes no service files or history. Users manage retention in their own service. Accepted document bytes no longer depend on those files or the service.

## Troubleshooting and provenance

- **Unavailable:** start the local instance and verify its numeric loopback port. A Desktop app version is distinct from its ComfyUI server version.
- **Version/node mismatch:** use a supported server with the built-ins above. PhotoSuite fails preflight rather than trying another graph.
- **Checkpoint absent:** use the exact filename reported by ComfyUI. A fresh Desktop installation may have no checkpoints.
- **Generation failed:** check the service logs, checkpoint architecture, CLIP/VAE and available memory. No automatic model fallback occurs.
- **Stale / unsupported source / oversized selection:** prepare an eligible raster, reduce the region if necessary and rerun.
- **Still stopping:** acceptance is already revoked; allow the owned transport to settle before another run.

ComfyUI's [GPL-3.0 license](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.4/LICENSE) does not license model weights. Model source/license/hash must be recorded independently for acceptance. PhotoSuite distributes none of the generation model/runtime stack. Checkpoints and runtimes installed separately for development remain outside the repository and application bundle. No M3+ features are included.
