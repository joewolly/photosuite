<p align="center">
  <img src="src/assets/img/icon_full.svg" alt="PhotoSuite Logo" width="128" height="128">
</p>

<h1 align="center">PhotoSuite</h1>

<p align="center">
  <strong>A local-first desktop PSD/PSB editor with a classic Photoshop-style workspace and modern local AI tools.</strong>
</p>

<p align="center">
  <a href="https://github.com/joewolly/photosuite/actions/workflows/build.yml"><img src="https://github.com/joewolly/photosuite/actions/workflows/build.yml/badge.svg" alt="Build Status"></a>
  <a href="https://v2.tauri.app"><img src="https://img.shields.io/badge/Tauri-v2-24C8D8.svg?logo=tauri&logoColor=white" alt="Tauri v2"></a>
  <a href="https://github.com/joewolly/photosuite/releases"><img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Linux%20%7C%20Windows-blue.svg" alt="Platform Support"></a>
  <a href="#open-source-used-here"><img src="https://img.shields.io/badge/Open%20Source-Submodules%20%26%20Libraries-green.svg" alt="Open Source"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#downloads">Downloads</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#what-this-is">What This Is</a> •
  <a href="#key-features">Features</a> •
  <a href="#supported-formats">Supported Formats</a> •
  <a href="#documentation">Documentation</a> •
  <a href="#building--testing">Building & Testing</a>
</p>

---

## Quick start

```sh
# Clone with submodules included
git clone --recursive https://github.com/joewolly/photosuite.git
cd photosuite

# Install dependencies and start in development mode
npm install
npm run dev
```

> **Note**: If already cloned without `--recursive`, initialise submodules before starting:
> ```sh
> git submodule update --init --recursive
> ```

---

## Downloads

Pre-built binary packages are available on the **[Releases](https://github.com/joewolly/photosuite/releases)** page:

| Platform | Package Format | Architecture |
|:---|:---|:---|
| **macOS** | Universal `.dmg` | Apple Silicon (arm64) & Intel (x86_64) |
| **Linux** | `.deb`, `.rpm` | x86_64 |
| **Windows** | NSIS installer (`.exe`) | x64 |

**Unsigned builds:** v0.10.0 artifacts are unsigned and not notarized, so macOS Gatekeeper or Windows SmartScreen may show an additional warning or confirmation before first launch. See the [v0.10.0 release notes](docs/releases/v0.10.0.md) for validation and known limits.

---

## Screenshots

Click any image for the full-resolution version.

<table>
  <tr>
    <td align="center"><a href="website/screenshots/001.png"><img src="website/screenshots/thumbs/001.jpg" alt="Start screen and New Project" width="280"></a><br><sub><b>Start screen & New Project</b></sub></td>
    <td align="center"><a href="website/screenshots/002.png"><img src="website/screenshots/thumbs/002.jpg" alt="Layer Style" width="280"></a><br><sub><b>Layer Style</b></sub></td>
    <td align="center"><a href="website/screenshots/003.png"><img src="website/screenshots/thumbs/003.jpg" alt="Camera RAW develop" width="280"></a><br><sub><b>Camera RAW develop</b></sub></td>
  </tr>
  <tr>
    <td align="center"><a href="website/screenshots/004.png"><img src="website/screenshots/thumbs/004.jpg" alt="Lens Correction" width="280"></a><br><sub><b>Lens Correction</b></sub></td>
    <td align="center"><a href="website/screenshots/005.png"><img src="website/screenshots/thumbs/005.jpg" alt="Filter Gallery" width="280"></a><br><sub><b>Filter Gallery</b></sub></td>
    <td align="center"><a href="website/screenshots/006.png"><img src="website/screenshots/thumbs/006.jpg" alt="Adjustments menu" width="280"></a><br><sub><b>Adjustments menu</b></sub></td>
  </tr>
</table>

---

## What this is

PhotoSuite is a desktop raster and vector graphics editor focused on PSD/PSB documents and a familiar classic Photoshop-style workspace. Panels, shortcuts and tools aim to feel familiar to Photoshop ~CS6 users, with modern local-assisted selection and editing alongside the classic tools.

* **PSD/PSB Native Format**: PSD is the native format, with support for layer records, masks, blending modes, channel data, descriptors, layer effects, smart-filter stacks, text engine data, vector paths, slices, and colour profiles. PSB is supported for large documents. Layered 32-bit PSD files are imported into PhotoSuite's existing RGB8 editing pipeline rather than being misread as flattened documents; this is not true 32-bit editing or HDR preservation. See the [compatibility audit](docs/modernization-integration-audit.md) for tested round trips and remaining limitations.
* **Offline-First & Private**: Built as a [Tauri v2](https://v2.tauri.app) application using HTML5, WebAssembly and WebGL in the system webview, with a Rust host for desktop integration. Bundled subject and object selection run locally in the app. Optional AI Remove, Generative Fill, Generative Expand and AI Upscale connect only to your explicitly configured local loopback ComfyUI service. No telemetry or cloud service is required; plugins and web features can still use the network.

> *Disclaimer*: Not affiliated with or endorsed by Adobe. Photoshop is a registered trademark of Adobe Inc., referenced here solely to describe the interface and behavioral specifications this project aims to replicate.

---

## What this is not

Gimp. Or Affinity. I'm certain they have great features, but my goal is not to make a mega-app with a billion functions (however, feel free to create any [plugins](docs/PLUGINS.md) you want!) - but to offer graphic designers a legal way to edit PSDs for free.

---

## Key features

* **Local AI & Modern Selection**:
  * **Select Subject**: Automatic foreground selection using the bundled BiRefNet-lite model and local ONNX/WASM inference; no cloud service or extra setup.
  * **Automatic Remove Background**: Uses the same local subject model to apply a non-destructive raster mask, preserving source pixels.
  * **Object Selection**: Enable AI point / box mode for the bundled SAM 2.1 model, with positive/negative points and box prompting. Corrections reuse the source embedding for responsive refinement.
  * **Quick Select**: Runs its expensive selection computation off the main UI thread for better responsiveness; no AI model required.
  * **AI Remove**: Selected-region object/content removal through local ComfyUI inpainting. Preview before accepting an ordinary raster layer.
  * **Generative Fill**: Optional text prompts and up to three bounded, sequential variations. Preview, switch, discard or accept one ordinary raster layer; pixels outside the authorized selection remain exact.
  * **Generative Expand**: Extends the canvas and generates only the newly exposed region. Original interior pixels remain exact, with preview before acceptance and exact offline Undo/Redo afterward. Support is intentionally limited to eligible RGB8 raster documents and bounded geometry.
  * **AI Upscale 4×**: Local Real-ESRGAN super-resolution through ComfyUI, with alpha preserved and resized separately. Accept opens a new ordinary raster document, leaving the source intact.
  * **Optional generation provenance**: Accepted Generative Fill layers can carry passive PSD/PSB metadata. Recipes can be disabled and prompts are not saved by default. Metadata never runs generation on file open; saved recipes cannot regenerate after reopening.

* **Layer Engine & Styles**:
  * Raster layers, vector layers, layer groups, clipping masks, and layer masks.
  * 1:1 Photoshop layer styles: Drop Shadow, Inner Shadow, Outer Glow, Inner Glow, Bevel & Emboss, Satin, Color Overlay, Gradient Overlay, Pattern Overlay, and Stroke.
  * Smart Objects and Smart Filter stacks with non-destructive editing.
  * Layer Comps palette and tracker.

* **Tools & Canvas Experience**:
  * Complete toolset: Marquee, Lasso, Magic Wand, Crop, Brush, Clone Stamp, Healing Brush, Eraser, Gradient, Blur/Sharpen, Dodge/Burn, Pen, Type, Shapes, Hand, Zoom, and Eyedropper.
  * Full canvas panning, zooming, rotation, pixel grid, rulers, and custom guides.
  * Deep History palette with snapshot support.

* **Filters & WebAssembly Acceleration**:
  * Classic Filter Gallery with multi-band runner and live thumbnails.
  * Liquify with interactive mesh warping.
  * Lens Correction backed by the [Lensfun](https://github.com/lensfun/lensfun) database.
  * WebAssembly-powered image processing (blur, median, WebP encode/decode, zstd compression, etc.).

* **Vector Geometry & Advanced Typography**:
  * Vector path geometry and boolean operations powered by [Paper.js](https://github.com/paperjs/paper.js).
  * High-fidelity font parsing via [Typr.js](https://github.com/photopea/Typr.js), complex text shaping via [HarfBuzz](https://github.com/harfbuzz/harfbuzz) (WASM), and bidirectional text layout via [FriBidi](https://github.com/fribidi/fribidi) (WASM).
  * Type along path, text warp, OpenType ligatures, kerning, and character/paragraph palettes.

* **Automation, Scripting & Extensibility**:
  * Photoshop Actions (`.atn`) parser and playback engine.
  * JavaScript/JSX scripting engine powered by [Acorn](https://github.com/acornjs/acorn).
  * Sandboxed sidebar plugins using plain HTML, CSS, and JavaScript communicating via IPC (see [PLUGINS.md](docs/PLUGINS.md)).

* **Native Desktop Integration**:
  * Native OS menus via Tauri.
  * Direct printing support (CUPS on macOS/Linux, Windows Spooler on Windows).
  * Drag-and-drop file loading and native OS file dialogs.

---

## Supported formats

PhotoSuite opens and exports a comprehensive range of raster, vector, and digital design formats:

| Category | Supported Formats |
|:---|:---|
| **Native & Adobe** | PSD, PSB, Adobe Illustrator (`.ai`), Adobe XD (`.xd`) |
| **Standard Raster** | PNG, APNG, JPEG, WebP, AVIF, TIFF, GIF, BMP, TGA, OpenEXR (`.exr`) |
| **Vector & Document** | SVG, PDF, PostScript (`.ps`), EPS, EMF, WMF, DXF |
| **Digital Design** | Sketch (`.sketch`), Figma (`.fig`), Affinity Photo/Designer (`.af` - WIP), GIMP (`.xcf`) |
| **Camera RAW** | DNG, CR2, NEF, ARW, and standard camera RAW formats |

---

## Documentation

Comprehensive architecture guides and development documentation are located in [`docs/`](docs/):

| Document | Description |
|:---|:---|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Codebase architecture, module layering rules, directory layout, and design principles. |
| **[docs/PLUGINS.md](docs/PLUGINS.md)** | Guide to writing sidebar plugins using standard HTML, CSS, and JavaScript. |
| **[Local AI setup & limits](#local-ai-setup--limits)** | Bundled selection tools, optional ComfyUI setup, model requirements and limits. |
| **[Modernization roadmap](docs/modernization-roadmap.md)** | Modernization scope, architecture decisions and future work. |
| **[AI roadmap](docs/AI-ROADMAP.md)** | Living roadmap for the M9–M18 local AI editing track, model decisions, acceptance gates and progress. |
| **[Integration audit](docs/modernization-integration-audit.md)** | Integrated editing, PSD/PSB persistence, macOS acceptance and known limitations. |
| **[Hosted CI validation](docs/hosted-ci-validation.md)** | Recorded JavaScript/Rust checks and cross-platform installer build evidence. |
| **[v0.10.0 release notes](docs/releases/v0.10.0.md)** | Release highlights, setup, validation and compatibility limits. |
| **[tests/README.md](tests/README.md)** | Behavioural test suite documentation, test harness, and mocking guidelines. |
| **[src/vendor/README.md](src/vendor/README.md)** | Complete third-party vendor provenance, pinned commits, upstream licenses, and build scripts. |

---

## Building & testing

### Prerequisites
* **Node.js**: v25 or newer
* **Rust**: Current stable toolchain (`rustup`)
* **Tauri Prerequisites**: Platform dependencies for [Tauri v2](https://v2.tauri.app/start/prerequisites/)

### Commands

```sh
npm run dev        # Launch the app from source with Tauri
npm run build      # Build the production application bundle for your current platform
npm test           # Run the behavioral test suite (2,100+ JavaScript tests)
npm run verify     # Verify imports, cyclic dependencies, static bindings, and bootstrap
npm run lint       # Run ESLint across src/
```

Automated cross-platform builds (macOS universal, Linux deb/rpm, Windows x64) are run on every release tag via [GitHub Actions](.github/workflows/build.yml).

Branch pushes and pull requests run JavaScript lint, verification and tests, plus Rust checks and tests. Run the Rust checks locally with `cargo check --locked --manifest-path src-tauri/Cargo.toml` and `cargo test --locked --manifest-path src-tauri/Cargo.toml`.

---

## Inspiration and prior art

This fork builds on **[PhotoSuite by eolix](https://github.com/eolix/photosuite)**, retaining the original author's work and upstream fixes.

The primary inspiration for this project is **[Photopea](https://www.photopea.com)**, Ivan Kutskir's browser-based editor, which demonstrated that a desktop-class image editor with complete PSD fidelity is achievable in a web runtime. The author has also open-sourced many format libraries utilised by this project. An archive snapshot is available at [ruanjiyang/Photopea-Offline](https://github.com/ruanjiyang/Photopea-Offline).

---

## Open source used here

Attribution and licence notices for everything bundled — vendored libraries, WebAssembly modules, icons, and the Rust crates linked into the binary — are collected in **[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)**, which ships with the application alongside its own licence.

All third-party libraries live in [`src/vendor/`](src/vendor/README.md) as pinned git submodules with their respective upstream licenses:

* **From the Photopea Author**: [UPNG.js](https://github.com/photopea/UPNG.js) (PNG/APNG), [UTIF.js](https://github.com/photopea/UTIF.js) (TIFF), [UZIP.js](https://github.com/photopea/UZIP.js) (ZIP/deflate), [Typr.js](https://github.com/photopea/Typr.js) (font parsing & shaping), [UTEX.js](https://github.com/photopea/UTEX.js) (TeX typesetting). *All MIT*.
* **Core Libraries**: [pako](https://github.com/nodeca/pako) (zlib, MIT), [Paper.js](https://github.com/paperjs/paper.js) (vector geometry, MIT), [omggif](https://github.com/deanm/omggif) (GIF, MIT), [js-sha1](https://github.com/emn178/js-sha1) (MIT), [acorn](https://github.com/acornjs/acorn) (JS parser, MIT), [linear-solve](https://github.com/lovasoa/linear-solve) (MIT), [parse-exr](https://github.com/dmnsgn/parse-exr) (OpenEXR, MIT), [pdf.js](https://github.com/mozilla/pdf.js) (JPEG/JPX/JBIG2 codecs, Apache-2.0), [PDFI.js](https://github.com/eolix/PDFI.js) (PDF/PS/EMF/WMF, MIT).
* **WebAssembly Modules**: [HarfBuzz](https://github.com/harfbuzz/harfbuzz) (text shaping, MIT), [FriBidi](https://github.com/fribidi/fribidi) (bidirectional text, LGPL-2.1+), [libwebp](https://github.com/webmproject/libwebp) (BSD-3), [zstd](https://github.com/facebook/zstd) (BSD-3), [stb_image](https://github.com/nothings/stb) (Public domain / MIT), [libheif](https://github.com/strukturag/libheif) (LGPL-3.0+).
* **Data & Assets**: [Lensfun](https://github.com/lensfun/lensfun) for camera and lens profile data (LGPL / CC), [Tabler Icons](https://github.com/tabler/tabler-icons) (MIT), [Font Awesome Free](https://github.com/FortAwesome/Font-Awesome) for the Shape tool's icon library (CC BY 4.0), [uiGradients](https://github.com/ghosh/uiGradients) for the Gradient tool's extra library (MIT), [Subtle Patterns](https://github.com/atlemo/SubtlePatterns) for pattern presets (CC BY-SA 3.0), individual [Brusheezy](https://www.brusheezy.com) artists for the extra brush libraries (CC BY-ND / CC BY-SA), [Fresh LUTs](https://freshluts.com) for Colour Lookup presets (CC0), and the DejaVu, Droid Sans Fallback, and Noto font families for script-fallback text rendering (Bitstream Vera + Arev / Apache-2.0 / SIL OFL 1.1).


---

## Local AI setup & limits

Bundled selection tools work offline without a service. Generative tools and AI Upscale require your own local ComfyUI installation and model files; ComfyUI, Stable Diffusion and Real-ESRGAN are not bundled or downloaded by PhotoSuite.

| Feature | Runtime | Extra setup |
|:---|:---|:---|
| [Select Subject / Automatic Remove Background](docs/m3/README.md) | Bundled ONNX/WASM | None |
| [Object Selection](docs/m4/README.md) | Bundled ONNX/WASM | None |
| Quick Select | Built-in worker computation | None |
| [AI Remove](docs/m2-local-inpaint.md) | Local ComfyUI | Compatible SD 1.5 inpainting checkpoint with CLIP and VAE |
| [Generative Fill](docs/m6/README.md) | Local ComfyUI | Reviewed `sd-v1-5-inpainting.ckpt` |
| [Generative Expand](docs/m8/README.md) | Local ComfyUI | Same reviewed generation checkpoint as Fill |
| [AI Upscale 4×](docs/m5b/README.md) | Local ComfyUI | Reviewed `realesr-general-x4v3.pth` |

Use the documented ComfyUI **0.37.4** setup (AI Remove also supports **0.37.0**). Configure the service in **Preferences → AI Remove**, using an explicit `http://127.0.0.1:PORT` or `http://[::1]:PORT` endpoint. Hostnames and cloud endpoints are unsupported. AI Remove, generation and upscale have separate model settings; Fill and Expand share the generation checkpoint. The linked guides include model hashes, licenses, supported inputs and setup checks.

Generative Expand supports eligible raster documents up to **1024 pixels per axis after expansion**, with at most **512 added pixels per side** and one preview at a time. Text, Smart Objects, vector content and other unsupported document types must be handled separately; see the [complete limits](docs/m8/README.md). AI Upscale accepts sources up to **1024 pixels per side and 524,288 total pixels**. Model output quality varies: review the [Fill](docs/m6/quality.md), [Expand](docs/m8/quality.md) and [Upscale](docs/m5b/quality.md) quality notes before accepting results.

[Generation metadata preferences](docs/m7/README.md) control passive provenance for accepted Generative Fill results. Recipes do not retain exact selection coverage and cannot regenerate after reopening. ComfyUI may retain its own uploads, outputs and prompt history separately from PhotoSuite's save preferences.
