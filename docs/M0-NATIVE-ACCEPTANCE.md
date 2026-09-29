# M0 native acceptance — 2026-09-27

**Verdict: PASS.** All required M0 acceptance paths passed in the actual Tauri application. No implementation defect was found, no implementation changes were made, and no new commit was required. This acceptance record is a local, uncommitted document.

## Checkout and environment

Starting and final branch: `codex/m0-exact-result-transactions`.

Starting and final HEAD: `a86c4548d5b22b3777647ef329f391ed2ee000d8`.

The pre-existing, untracked `docs/modernization-roadmap.md` was left unchanged. There were no dependency, lockfile, Rust source, Tauri configuration, or platform-minimum changes. No push, release, or M1/AI/runtime work was performed.

| Component | Verified environment |
| --- | --- |
| Host | Apple Silicon, macOS 27.0, build 26A428 |
| Xcode | 27.0, build 27A266a |
| Node / npm | v26.10.0 / 11.19.1 |
| Rust | 1.98.1, aarch64-apple-darwin, LLVM 22.1.8 |
| Cargo / rustup | 1.98.1 / 1.29.1 |
| Tauri | CLI 2.12.0; existing locked Rust crate 2.12.0 |

Rust was initially absent and was installed with the official rustup stable minimal profile. Shell startup files were not changed; build commands sourced `/Users/joe/.cargo/env`.

`npm run dev` built and ran `target/debug/photosuite` successfully in 1m 07s. The native automation resolver could not address the unbundled development process and found unrelated older app copies, so acceptance used the same checkout packaged by `npm run build -- --debug --bundles app --no-sign`. That build succeeded in 50.92s. The app was launched by its exact path:

`/Users/joe/Documents/CodexProjects/PhotoSuite/src-tauri/target/debug/bundle/macos/PhotoSuite.app`

This is local debug-build evidence, not distribution signing or notarization evidence. Web Inspector showed successful initialization of 749 system fonts. Its All console view contained no new M0 errors after the acceptance scenarios.

## Native acceptance results

The controlled source document was 256 × 192. Its ordinary, unlocked raster layer contained blue background pixels `[30, 90, 180, 255]` and an orange rectangle `[245, 140, 30, 255]` at `(64, 48, 128, 96)`. A second fixture also had an enabled rectangular vector mask at `(48, 32, 160, 128)`.

| Scenario | Native result and exact evidence |
| --- | --- |
| Ordinary selection | Rectangle Select was activated in the native UI. A pointer drag around the visible orange rectangle exported precisely `(64, 48, 128, 96)`, with every coverage byte 255. |
| Remove Background | Invoked from the native Layer menu. A linked raster mask appeared, the blue background became transparent, and source pixels were unchanged. Mask bounds matched the selection; outside coverage was 0. |
| Mask Undo / Redo | Native Edit → Step Backward restored the complete original pixel/composite state and removed the mask. Step Forward restored the identical mask and composite. History increased from 2 to 3 only on the original operation. |
| No selection | The native Remove Background menu item was disabled. |
| Soft selection | A plugin supplied `(64, 48, 128, 96)` coverage with edge bands 64, 128, 192 and interior 255. `getSelectionMask` returned all 12,288 bytes exactly. Native Undo restored the preceding hard selection; Redo restored every supplied soft byte. |
| Existing raster mask | Native Remove Background intersected the soft selection with the preceding hard raster mask, preserving exact soft coverage and source pixels. History increased from 4 to 5. |
| Full selection | Native Select → All, followed by Remove Background, produced a `(0, 0, 256, 192)` all-255 raster mask with outside coverage 0. The visible composite remained unchanged. |
| Locked target | The native Layers panel All lock was enabled. Remove Background displayed “Unlock and show the raster layer first”. History stayed at 9, and the complete serialized document state was unchanged. |
| Vector coexistence | The second fixture retained its enabled, nonempty vector path while Remove Background added the soft raster mask. Both mask thumbnails remained visible. Source pixels and vector path records were preserved. |
| Exact raster insertion | The discovered, sandboxed sidebar plugin negotiated `getCapabilities`, read `getDocumentInfo`, prepared the selected target, and called `insertRaster`. It inserted the supplied alternating magenta pixels in a 17 × 13 layer at `(16, 24)`. The layer appeared in the intended document and added one history entry, from 5 to 6. |
| Raster Undo / Redo | Native Undo restored the entire pre-insert document. The plugin was actually reloaded before Redo. Native Redo restored every inserted byte, bounds, layer structure, and composite without another insertion request. |
| Wrong target / stale history | A wrong document ID was rejected with “Wrong, stale or consumed result target”. Preparing a target, changing selection through native Select → All, then committing was rejected with “Document history changed; prepare again”. No extra raster or operation history was added. |
| Plugin sessions | Reloading the actual iframe produced a different session ID. An invalid session was rejected with “Wrong or expired plugin session”. Replaying a retained old session ID across reload remains covered by the existing automated IPC tests rather than this native harness. |
| PSD roundtrip | Native File → Save as → PSD saved `m0-native-roundtrip.psd`. Its document tab was closed, then the file was reopened using the native Open dialog. Reopened data matched the pre-save result: two layers, exact insertion bounds/bytes, unchanged source pixels, raster mask, enabled vector path, and composite. The reopened native canvas was visually inspected at Fit The Area. |

The test plugin used only existing structured commands and legacy `getSelectionMask` / action-script export for observations. Native menu actions performed masking and history navigation. Its PSD snapshots were decoded with the real repository parser and compared to the supplied byte arrays; this did not substitute for native interaction. The temporary plugin was subsequently moved out of the app's discovery directory, and the localhost receipt server was stopped.

## Previous browser coordinate mismatch

The earlier standalone-browser smoke was not representative of the native editor. A separate, disposable browser diagnostic reproduced a mismatch on the existing **New** button, before invoking any M0 operation:

- The in-app browser reported a 347 × 776 CSS viewport with device-pixel ratio 2. The New button's DOM bounds were `x=24, y=209, width=188.2109375, height=39.5`.
- Its displayed screenshot was 326 pixels wide and showed the button around screenshot position `(110, 261)`; the element-based click missed.
- Clicking that observed screenshot position opened New Project successfully.

This demonstrates a mismatch between the browser harness's DOM and displayed screenshot/control coordinates, including the narrow embedded viewport. It affects an existing control outside M0. The underlying browser automation implementation was not modified or fully debugged.

The actual native app used its normal 1440-wide window, AppKit menu selection, and a Retina screenshot pointer drag. The drag landed exactly on the known foreground bounds, and the ordinary selection, supplied selection, raster insertion, mask, and PSD coordinates all matched their document-space expectations.

The existing coordinate path subtracts the target element's client origin (`core/dom.js`), scales panel coordinates to backing pixels (`PluginToolPanel.assignPointerStateToMouseEvent`), and applies the viewport pan/zoom/rotation transform (`CanvasViewport.screenToDocPoint`). Selection tools retain the resulting document-space rectangle. M0 Remove Background copies that selection rectangle and its logical coverage bytes directly into the raster-mask transaction; it does not reinterpret browser/screen coordinates. No evidence implicated M0 or its masking path in the earlier click failure.

## Final validation and retained evidence

- `npm test`: **1,780 passed**, 422 suites, 0 failed, 0 skipped, 0 cancelled.
- `npm run lint`: passed.
- `npm run verify`: all eight checks passed.
- `git diff --check`: passed.
- Independent assertions over the native receipts and PSD snapshots: **19 passed**.
- Rust source remained unchanged; no Rust test run was needed for this acceptance-only pass.

Evidence is retained outside the repository at:

`/Users/joe/Documents/Codex/2026-09-27/photosuite-m0-native-acceptance/`

It includes `acceptance-assertions.json`, `verify-evidence.mjs`, `events.jsonl`, native baseline/undo/redo PSD snapshots, `m0-native-roundtrip.psd`, `native-reopened.psd`, toolchain/build logs, validation logs, fixture-generation code, and the archived acceptance plugin. The verifier can be rerun with `node verify-evidence.mjs` from that directory while this repository remains at its current path.

| Exact data | SHA-256 |
| --- | --- |
| Source layer RGBA | `1824b4f13267ea2bb758140d8e93b26047d8c55f91700e52178eb71b86d6f6e6` |
| Soft mask coverage | `2aaf3c896e61c741cb08399e7148aa133f4e8d967d79ff47792396a0612cccb6` |
| Inserted layer RGBA | `83f0f0573ef10b9db4c8b6476adb6eb66e9a1e9d039fb217f1dbf2ddc191b560` |
| Reopened composite RGBA | `4893187468186d133901d7f34e8cc36a49fc27a150effb2458e75318147adfcc` |
| Native Save As PSD file | `71de6ac13ffc91c4df9b6e2a499f649931c4bde366cadf5995d5a0ac31736c2a` |

Limits: local Apple Silicon debug acceptance only. No Photoshop interoperability claim, release/notarization claim, or additional platform acceptance is made. Soft coverage was tested directly; a separate Gaussian-feather UI scenario was not needed for the requested feathered/soft case. No product fixes or regression tests were added because no M0 defect was found.
