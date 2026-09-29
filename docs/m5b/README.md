# M5b — AI Upscale

Image → **AI Upscale…** captures the current document's rendered RGB8 composite. Check the backend, then Run 4×. A reduced preview appears in the existing jobs strip. **Accept** creates one new unsaved ordinary raster document named `<original> — AI Upscale 4x.psd`; **Discard** releases the result. The original layers, dimensions, pixels and history are untouched. Save the new document explicitly using normal PSD/PNG workflows. It has no continuing backend dependency or special AI layer. There is no source-document or cross-document Undo entry.

This is neural super-resolution, not recovery of known original detail. Small text, logos, faces and fine patterns can change. Inspect the result; standard Image Size interpolation remains preferable for exact artwork. See [comparison findings](quality.md) and [acceptance evidence](acceptance.md).

## Local setup

Use user-managed **ComfyUI 0.37.4**, listening on `http://127.0.0.1:8188` (or another explicit numeric-loopback port, including `[::1]`). Reuse the endpoint in Preferences → AI Remove. Upscale does not use or change AI Remove's inpainting checkpoint or require AI Remove to be enabled.

Install the official [realesr-general-x4v3.pth release artifact](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth) in your ComfyUI `models/upscale_models` folder and refresh/restart ComfyUI. PhotoSuite does not download, bundle or convert the model. Verify the file before use:

- File: `realesr-general-x4v3.pth`, 4,885,111 bytes.
- SHA-256: `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292`.
- Source: official xinntao/Real-ESRGAN v0.2.5.0 release; [model zoo](https://github.com/xinntao/Real-ESRGAN/blob/a4abfb2979a7bbff3f69f58f58ae324608821e27/docs/model_zoo.md).
- Native scale: 4×. SRVGGNetCompact general-purpose small RGB model; no face restoration or post-model downsampling.
- License: official project's BSD-3-Clause, [retained license](REAL-ESRGAN-LICENSE.txt). This review applies to this official artifact, not arbitrary community checkpoints.

Preflight checks reachability, version, four node schemas and the exact model identifier. Stock ComfyUI does not expose a weight hash through this preflight API: users must keep the verified artifact under this name. PhotoSuite cannot attest the server's on-disk file contents. No fallback model is selected.

## Bounds and pixels

Only native 4× is supported. Sources must fit **1024 pixels per side AND 524,288 total pixels** (e.g. 1024×512). Outputs fit **4096 per side AND 8,388,608 pixels**, at most **32 MiB RGBA**. A 1024×1024 source is rejected. Safe-integer geometry and a conservative editor working-allocation estimate (10 output buffers + 24 bytes/source pixel + 4 MiB, ceiling 384 MiB) are checked before capture/upload. Rust independently enforces source/output limits before encoding or networking, then caps PNG transfer/decode at 33 MiB and checks exact dimensions/format. These are operation limits, not guarantees about total app RAM with other documents open.

The limit was retained after actual 1024×512 → 4096×2048 inference/native acceptance on a 16 GiB Apple M5, including output transfer and new document creation. It is deliberately below a 1024-square source, whose 64 MiB output would double the main editor cost. It is not an inherited M2 inference limit or a universal hardware benchmark. See measured RSS and timings in [acceptance](acceptance.md).

Input/output are PhotoSuite's current straight RGBA8 pixels, interpreted as sRGB without new ICC conversion. There is no HDR, wide-gamut, CMYK or 16-bit pipeline. Channel-isolated editing and artboards are rejected. Selection does not crop the operation. Hidden layers influence neither the captured composite nor the model.

Alpha never enters the RGB model. Covered pixels retain their straight RGB; fully transparent pixels receive deterministic nearest covered color by breadth-first Manhattan extension (scan-order tie break). All-transparent sources use black. Original alpha is resized separately with separable Catmull–Rom cubic interpolation, pixel-center alignment, clamped edges and rounded/clamped 8-bit output. RGB is cleared wherever final alpha is zero; elsewhere the model's RGB is used unchanged. This avoids hidden-color/matte contamination; it does not promise that the model itself cannot produce ringing. Output assembly yields every 32 rows for cancellation.

## Workflow and lifecycle

Repository-controlled `photosuite-upscale-v1` is constructed in `src-tauri/src/comfy/upscale.rs`:

`LoadImage (2)` + `UpscaleModelLoader (1)` → `ImageUpscaleWithModel (3)` → `SaveImage (9)`.

These are stock 0.37.4 nodes. No custom nodes, arbitrary workflow JSON, new runtime or custom tiler are required. The reviewed [stock tiler](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.4/comfy_extras/nodes_upscale_model.py) uses 512-pixel tiles with 32-pixel overlap; OOM retries reduce tiles to 256 then 128. Final dimensions are exact native model scale. The limit-corpus seam crop showed no obvious join; this is not a guarantee for every image/device.

M1 owns queued/preparing/running/preview/committed/cancelled/failed/stale states. Only one upscale workload or retained result is allowed. The retained full output is accompanied by a ≤256-pixel thumbnail, not a full-resolution overlay on the original. Accept uses the exact retained raster and normal document creation with its normal initial history. The layer explicitly retains full generated extent, including transparent borders.

M2 owns numeric-loopback-only Rust HTTP, disabled redirects/proxies, shared single workload lease, bounded requests, identity/graph verification, owned uploads/outputs and targeted per-job cancellation. No global ComfyUI interrupt is issued. Cancel revokes editor authority immediately; transport may take time to stop, shown as stopping. Late completion cannot create a document. Closing the source cancels; changing rendered pixels, canvas dimensions or history invalidates it. Freshness is checked on completion and again at Accept; switching tabs cannot redirect it.

## Troubleshooting

- **Cannot reach service:** start ComfyUI and check the numeric loopback endpoint in Preferences.
- **Unsupported version/node schema:** use the reviewed 0.37.4 stock nodes; do not bypass the check.
- **Model unavailable:** verify exact filename, folder and hash, then refresh/restart ComfyUI. Inpaint checkpoints are separate.
- **Over budget:** use a smaller source; no upload or inference occurs.
- **Source changed:** discard/rerun from the current rendered document.
- **Malformed/wrong-sized result, service restart or timeout:** no document is created; inspect service logs and rerun explicitly. Submission is never automatically retried.
- **Cancelling:** wait for the owned backend workload to stop before another local enhancement. Unrelated server work is not interrupted.

Only macOS native/MPS acceptance is established. Rust transport is platform-neutral; Windows/Linux inference and GPU behavior remain untested. M5a and M6+ are outside this change.
