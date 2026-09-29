# Post-M8 hosted CI validation

Validation started 2026-09-28 (America/Denver). This report supplements, rather than replaces, [the local integration audit](modernization-integration-audit.md). No application feature, release, merge, tag, history rewrite, or repository setting change is authorized by this report.

## Baseline and registration

- Repository: `joewolly/photosuite`, a public fork of `eolix/photosuite`.
- Starting branch: `codex/modernization-stability-audit`.
- Local and remote stabilization HEAD: `b87b2b765bbb36110c402d0d166ded2efecb35e6`; working tree initially clean.
- Accepted M8 ancestor: `96e33e399e39ac03dfb5dd416006391b3866c5c0`; verified with `git merge-base --is-ancestor` and the remote M8 ref.
- Default branch: `main`, remote SHA `be4f9e6a8f288f6ff27b7eea8481b69918698fcc`.
- Actions permissions API: HTTP 200, `enabled: true`, `allowed_actions: all`, `sha_pinning_required: false`. Workflow token default: `read`; pull-request review approval disabled. Repository neither archived nor disabled.
- Workflow `369740298`, `PhotoSuite`, `.github/workflows/build.yml`: active, created `2026-09-29T03:16:51Z`.
- The stabilization push created [run 36516436742](https://github.com/joewolly/photosuite/actions/runs/36516436742) at that same time, event `push`, exact starting SHA. Registration is now working; no registration repair or settings change was needed.

The earlier audit retained zero-workflow/zero-run API results despite Actions being enabled and the workflow existing on `main`. This task directly observed registration and successful execution after the push. That establishes the resolving event, **not GitHub's internal cause of the earlier empty registry**. Historical fork activation, billing, permissions, or a service defect cannot be inferred from these responses. There is no demonstrated external blocker now.

Raw HTTP responses, run/job JSON and logs are retained outside the application/repository in `/Users/joe/Documents/Codex/2026-09-28/photosuite-hosted-ci-validation/`. The earlier snapshot remains in the prior audit evidence directory. No credentials are included in the saved request evidence.

## Workflow review

The stabilization workflow performs recursive submodule checkout, Node setup, `npm ci`, vendor repair, lint, all verify checks and tests. Rust runs on Ubuntu 24.04 with WebKit/Tauri/CUPS dependencies, stable Rust, locked Cargo check/test, and locked dependency-notice freshness validation. Three real-backend tests remain ignored; ordinary test execution requires no running ComfyUI, external inference weights or model provisioning. The repository's already-bundled ONNX/WASM assets are obtained by checkout.

Push checks validate branch HEAD. PR checks validate the synthetic merge result with the default checkout behavior; same-repository PRs are no longer skipped. These two check runs are intentional coverage of different Git states. Installers do not run on either ordinary event, and superseded runs on the same ref are cancelled. This simple policy is retained; it avoids duplicating the full build matrix and preserves merge-confidence coverage. No open PR existed during this validation, so PR behavior is source-reviewed rather than a new hosted PR experiment. GitHub documents the [event/ref and checkout semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).

Manual builds depend on green JS and Rust checks. Platform configuration merges select macOS app/DMG, Windows NSIS, and Linux DEB/RPM. A branch manual dispatch cannot enter the tag-only release job.

## Hosted checks

Both checks passed in push run **36516436742**, on `b87b2b765bbb36110c402d0d166ded2efecb35e6`:

| Check | Job | Runner/toolchain | Result | Job duration |
|---|---|---|---|---|
| Lint and test (JavaScript) | [109239650870](https://github.com/joewolly/photosuite/actions/runs/36516436742/job/109239650870) | Ubuntu 24.04 x64 (`ubuntu-latest`); Node 25.9.0, npm 11.12.1 | Checkout/submodules, install, vendor repair, lint, verify, **2,126 passed / 424 suites / 0 failed / 0 skipped** | 1m44s; test process 31.43s |
| Check and test (Rust) | [109239650676](https://github.com/joewolly/photosuite/actions/runs/36516436742/job/109239650676) | Ubuntu 24.04 x64; stable Rust 1.98.1 (`48a229cea`, 2026-09-01) | Dependencies, locked check/test, notices: PASS; **25 passed / 3 ignored / 0 failed**; bin/doc targets pass | 7m42s; library tests 7.98s |

Counts exactly match the accepted local baseline. Ignored tests are `real_expand_corpus`, `real_generative_corpus`, and `real_upscale_corpus`.

Warnings: Node module-type detection and deprecated APIs; Actions v4 runtime deprecation (GitHub forced Node 24); upcoming `ubuntu-latest` migration notice; existing platform-specific Rust unused/dead-code warnings. These did not fail the checks. Action upgrades and platform pinning are future maintenance, not required repairs for this run.

## Platform matrix

Manual [run 36517028464](https://github.com/joewolly/photosuite/actions/runs/36517028464) was dispatched only after the push checks passed, at the same stabilization SHA.

| Platform | Job | Result | Duration | Artifact |
|---|---|---|---|---|
| Windows x64 | [109242616910](https://github.com/joewolly/photosuite/actions/runs/36517028464/job/109242616910) | PASS: checkout/submodules, toolchain, vendor repair, Tauri/NSIS, upload | 17m29s | `PhotoSuite-windows`, ID `11012266008`; `PhotoSuite_0.9.14_x64-setup.exe`, **211,941,615 bytes** |
| macOS universal | [109242617026](https://github.com/joewolly/photosuite/actions/runs/36517028464/job/109242617026) | PASS: checkout/submodules, both Rust targets, Tauri universal app/DMG, upload | 18m54s | `PhotoSuite-macos`, ID `11011519114`; `PhotoSuite_0.9.14_universal.dmg`, **429,284,633 bytes** |
| Linux x64 | [109242616991](https://github.com/joewolly/photosuite/actions/runs/36517028464/job/109242616991) | PASS: native dependencies, Rust/frontend, DEB/RPM, upload | 49m59s | `PhotoSuite-linux`, ID `11012432274`; DEB/RPM |

The manual run's prerequisite JS and Rust jobs also passed with identical test counts; notice freshness again reports 520 crates. No retries or repository changes were needed to obtain either set of hosted checks.

### Linux RPM packaging investigation and CI-only repair

The initial Linux job compiled successfully in 7m07s, bundled DEB, then remained at RPM bundling for more than 40 minutes without another log line. This phase was directly observed through the authenticated GitHub Actions page in Safari; the API did not yet expose a job log archive. The application compiler was not the blocked phase.

The installed locked Tauri CLI is 2.12.0. Its [RPM bundler source](https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.12.0/crates/tauri-bundler/src/bundle/linux/rpm.rs) defaults to Gzip level 6. Maintainers describe substantial RPM compression delays for large binaries in [issue 11478](https://github.com/tauri-apps/tauri/issues/11478). This is supporting context, not proof of this runner's exact internal state; CPU/thread activity was not exposed.

Created `codex/hosted-ci-validation` from the exact pushed stabilization SHA. Commit **`5030c637e8c290427f186f8bf6a3182aeb29f02c`** changes only the Linux matrix's Tauri arguments to merge an RPM compression override: Zstd level 3. It leaves application code, package contents, dependencies, product configuration, ordinary CI jobs, macOS and Windows arguments unchanged. YAML parsing, shell argument grouping and JSON decoding pass. All requested local checks passed again after this change. The branch was pushed normally; no force-push or history rewrite.

The original Linux run subsequently **passed**: RPM bundling ran from `03:38:12Z` to `04:19:26Z` (41m14s), while DEB bundling took about 8s. Total job duration was 49m59s. This was a severe packaging-performance issue, **not a product compile failure or a permanently hung job**. The original stabilization SHA therefore obtained green evidence for all five hosted gates. No original job was cancelled or retried.

Successor push [run 36520927305](https://github.com/joewolly/photosuite/actions/runs/36520927305) passed: JS job `109253372911`, 2,126 passed in 1m49s; Rust job `109253372712`, 25 passed / 3 ignored, notices 520 crates current, in 7m02s. Ubuntu 24.04, Node 25.9.0 and Rust 1.98.1 remain unchanged.

Successor manual matrix [36521479942](https://github.com/joewolly/photosuite/actions/runs/36521479942) **passed at `5030c637e8c290427f186f8bf6a3182aeb29f02c`**. Its prerequisite jobs again report 2,126 JS passes and 25 Rust passes / 3 ignored, with 520 crate notices current. Draft release was skipped.

| Successor build | Job | Duration | Artifact ID | Uploaded ZIP size |
|---|---|---|---|---:|
| macOS universal | `109256161770` | 13m13s | `11012828879` (`PhotoSuite-macos`) | 428,277,226 |
| Windows x64 | `109256161681` | 17m24s | `11013627132` (`PhotoSuite-windows`) | 211,993,571 |
| Linux x64 | `109256161758` | 20m41s | `11013900357` (`PhotoSuite-linux`) | 426,644,003 |

Successor Linux compilation took 6m55s; DEB packaging about 8s; RPM packaging **12m00s** (`04:37:21Z` to `04:49:21Z`). Compared with 41m14s for the original Gzip run, the observed RPM duration fell about **71%**. This is a two-run comparison on separate hosted runners, not a controlled performance benchmark or proof of the bundler's internal bottleneck. Packaging still takes minutes; no claim of eliminating all RPM overhead. No product-source workaround, dependency upgrade, timeout masking or repeated retry was used.

Runner images for the matrix: macOS 26.6.2 ARM64 (`macos-26-arm64`, builds both target architectures), Windows Server 2025 x64, Ubuntu 24.04.5 x64. All jobs used Rust stable 1.98.1 and Node 25.9.0. Windows reqwest/PNG/UUID/Tauri compilation and resource packaging passed; this does not establish Windows IPC or inference runtime acceptance.

### Downloaded package inspection

Windows: the installer is NSIS-3 Unicode and contains a PE32+ x86-64 application. The application contains exact Brotli-compressed copies of the three tracked ONNX files and ORT WASM runtime, plus the expected asset keys. The shipped license and notices match the repository after CRLF normalization (raw hashes differ because of Windows checkout line endings). Only ordinary application/installer files appear in the archive; no development evidence directory was found. This proves build/bundle content, not Windows runtime behavior.

macOS: the DMG checksum verification passes. The app contains a Mach-O universal executable with x86_64 and arm64 slices; all four model/runtime payloads occur twice, once per architecture, as expected for a universal executable. This is not accidental duplicate resource packaging. License and notices bytes match exactly. The app contains Info.plist, executable, icon and the two notice resources; no evidence directories were found. Apple credential setup was skipped. Direct `codesign` inspection shows arm64 **ad-hoc, linker-signed**, no TeamIdentifier or sealed resources; x86_64 is **unsigned**. There is no Developer ID signing or notarization. The DMG is a validation artifact, not a production release.

The focused asset probe reproduces Tauri's release compression with the locked `brotli 9.0.0`, quality 9, and searches for the complete compressed payload, not merely an asset-name string. Probe source, expected payloads, per-package offsets and archive inventories are retained with the external evidence. Package extraction does not install or execute PhotoSuite.

Linux: both original DEB and RPM packages extract successfully and contain an ELF x86-64 application, desktop entry, icons and two notice resources. Their embedded model/runtime payloads match exactly; notices match repository bytes. No development evidence directories appear. The original RPM payload is Gzip. The successor RPM is directly verified as **Zstd**, and its DEB/RPM file inventories, exact model/runtime payloads and notices pass the same checks. Successor Windows/macOS artifacts were also downloaded and their model/runtime payloads rechecked; macOS signing remains linker ad-hoc on arm64 and unsigned on x86_64. Neither matrix establishes Windows/Linux runtime, installation or inference acceptance.

Final downloaded installer sizes (distinct from the enclosing Actions ZIP sizes above):

| File | Bytes | SHA-256 |
|---|---:|---|
| `PhotoSuite_0.9.14_universal.dmg` | 429,284,622 | `a727a41760f24b2b7e16992db4d751489f6f6a17101ebe90fb8f3d34860b804c` |
| `PhotoSuite_0.9.14_x64-setup.exe` | 211,948,041 | `9a887104407acf68a6da20c67e144acfafa4c42f042340463b08fd0abcc81305` |
| `PhotoSuite_0.9.14_amd64.deb` | 213,696,886 | `7b6afcb5eda44cfe4d8c8ee080717326a61ab65e02685a06d7682d4d5c0fac2b` |
| `PhotoSuite-0.9.14-1.x86_64.rpm` | 213,030,911 | `5e50841dcc1619fdd7e20a9a58ca67bc1cce3b1ba60e23b4995379af7c597e04` |

## Recommended eventual main protection

Require the exact check names **`Lint and test (JavaScript)`** and **`Check and test (Rust)`**, from GitHub Actions. Retain PR merge-result checks, and require the PR to be current with its target when relying on these results. The manual-only platform jobs are unsuitable as unconditional PR-required checks because ordinary PRs do not execute them. Branch protection was not changed.

## Final acceptance

**PASS WITH NOTES.** Recommend **`5030c637e8c290427f186f8bf6a3182aeb29f02c`** on `codex/hosted-ci-validation` as the **PhotoSuite post-M8 accepted stable development baseline**. Local checks remain green; hosted JS/Rust and all three platform builds are green at this exact SHA; artifact sanity checks pass; no new Blocker or High finding was demonstrated. The accepted application source is unchanged from the locally audited stabilization commit. Its original native acceptance remains applicable within that audit's stated scope; it was not rerun or relabeled as cross-platform acceptance.

The shared-baseline gate is satisfied, so beginning M9/M10 on this baseline is reasonable. Neither was implemented here. `main` was not merged, branch protection/settings were not changed, and no tag or release was created. The stabilization branch remains at its original SHA. The CI-fix commit is pushed normally; this focused report is a local documentation deliverable and is the only uncommitted repository file.

Remaining notes: RPM bundling still took 12 minutes in the improved run; the performance comparison is not a guarantee for other runners. Action-runtime deprecations, Node warnings and platform-specific Rust dead-code warnings remain non-failing maintenance items. macOS is not Developer-ID signed or notarized; Windows/Linux runtime is unverified; no production-release claim. Earlier audit limitations (memory envelope, inherited CSP, clone-history uncertainty and model-storage/release-identity decisions) remain documented there and were not silently cleared by green builds. The historical reason for GitHub's earlier empty workflow registry remains unconfirmed, but its operational effect is resolved by directly observed registration and successful push/manual runs.

## Local validation of this documentation change

`npm test`: 2,126 passed, zero failed/skipped; `npm run lint`, `npm run verify`, `git diff --check`, `cargo check --manifest-path src-tauri/Cargo.toml`, and `cargo test --manifest-path src-tauri/Cargo.toml`: PASS. Rust again reports 25 passed / 3 ignored, with bin/doc targets passing. The first shell invocation could not locate Cargo (exit 127); the retry added the existing `/Users/joe/.cargo/bin` to PATH and succeeded. This was a local shell-path issue, not a CI/product defect. Logs retain both attempts. No application source was changed, and native/model acceptance was not rerun.

The same complete local validation sequence passed again after the CI override (`fix-local-*.log`), with identical counts. Final documentation edits also pass whitespace/diff checks. The only committed change after stabilization is the four-line addition/one-line replacement in `.github/workflows/build.yml`.

## Requested completion checklist

| # | Result |
|---:|---|
| 1 | Starting branch `codex/modernization-stability-audit`, SHA `b87b2b765bbb36110c402d0d166ded2efecb35e6`; clean. |
| 2 | Remote stabilization SHA exactly matches the starting SHA and remains unchanged. |
| 3 | Push triggered run `36516436742`. |
| 4 | Workflow `369740298` registered and active. |
| 5 | Historical empty-registry cause unconfirmed; registration became operational on the pushed event. |
| 6 | Prior zero-count receipt; current workflow creation timestamp, push event/SHA, API permissions and successful runs retained. No billing/fork-setting guess. |
| 7 | No repository/account/Actions/protection setting changes. |
| 8 | Linux hosted RPM compression override only: Zstd level 3; observed packaging 41m14s → 12m00s. |
| 9 | `codex/hosted-ci-validation`, local/remote `5030c637e8c290427f186f8bf6a3182aeb29f02c`. |
| 10 | Hosted JS PASS in push `36520927305` and manual `36521479942`. |
| 11 | JS: 2,126 passed, 424 suites, zero failures/skips. |
| 12 | Hosted Rust PASS in both successor runs. |
| 13 | Rust: 25 passed, 3 ignored; bin/doc targets pass; 520 crate notices current. |
| 14 | macOS universal build/upload PASS, job `109256161770`. |
| 15 | DMG inspected; arm64 linker ad-hoc, x86_64 unsigned; no Developer ID/notarization. |
| 16 | Windows x64 build/upload PASS, job `109256161681`; runtime unverified. |
| 17 | NSIS `PhotoSuite_0.9.14_x64-setup.exe`, inspected. |
| 18 | Linux x64 build/upload PASS, job `109256161758`; runtime unverified. |
| 19 | `PhotoSuite_0.9.14_amd64.deb` and `PhotoSuite-0.9.14-1.x86_64.rpm`, inspected. |
| 20 | Expected architectures/assets/notices; no observed development-evidence packaging; final sizes and hashes above. |
| 21 | No new Blocker finding demonstrated. |
| 22 | No new High finding demonstrated. |
| 23 | CI packaging performance improved but remains a maintenance note; non-failing toolchain warnings and inherited audit limitations remain. |
| 24 | JS tests/lint/verify, Cargo check/test, YAML/shell/JSON parsing and diff hygiene PASS after workflow change. |
| 25 | Recommend `Lint and test (JavaScript)` and `Check and test (Rust)` as required checks; no protection mutation. |
| 26 | Accepted-base recommendation: `5030c637e8c290427f186f8bf6a3182aeb29f02c`. |
| 27 | M9/M10 may begin on the accepted baseline; no implementation in this task. |
| 28 | **PASS WITH NOTES** for the shared development baseline; no release/runtime overclaim. |
