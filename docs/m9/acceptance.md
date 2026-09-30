# M9 acceptance and completion report

**Status: DONE — native macOS PASS with the evidence limits below.**

M9 meets all fifteen definition-of-done items. Remove, Fill, Expand and Upscale
use the capability registry and existing M1/M0 authority. Model choices, settings,
workflow graphs, geometry, candidates, containment, passive provenance and
permanent-edit behavior remain compatible with v0.10.1. M10 has not begun.

## Git and scope

- Initial branch: clean `main` at released v0.10.1
  `1e1421db44e84fd9cdeba4ff214b062f96c7dc13`.
- Fetched origin and fast-forwarded `main` to
  `4fcb483fc5eb911c80dccd071f59b6bf715b95af`; the two intervening commits only
  add/link the AI roadmap. This is the actual branch starting SHA.
- Final branch: `codex/m9-ai-provider-architecture`.
- Implementation commit: `8c48d5154cfc9ed89ceff460be6767d52ad03edc`,
  `refactor(ai): route editing capabilities through provider registry`.
- Completion documentation is the following local
  `docs(ai): record M9 acceptance and advance roadmap` commit. Its SHA is
  recorded in the final chat report and `git log` rather than self-embedded here.
- Working tree: clean at completion. No PR, push, merge, tag, release, installation,
  public artifact publication, M10 integration or new model download.

Architecture and extension instructions are in [README](README.md). The
[pre-implementation trace/plan](implementation-plan.md) records the baseline
paths and the M6/M7 documentation reconciliation. Machine evidence is in
[acceptance-receipt.json](acceptance-receipt.json) and
[package-inspection.json](package-inspection.json).

## Architecture review and compatibility

Before M9, features selected ComfyUI factories/preflights, prepared model-padded
input and constructed model-specific Fill provenance. Two JS transports repeated
request/poll/cancel ownership. After M9, features provide explicit logical pixel
contracts; immutable provider selections resolve in `AIProviderRegistry`; stateless
ports join the existing M1 service. The Comfy handler owns configuration, identity,
padding/cropping and transport. One shared JS request lifetime consolidates the
existing targeted cancellation and settlement behavior. Rust transport is unchanged.

Capabilities are Remove, Fill, Expand and Upscale, plus reserved unsupported
instruction/reference edit identifiers. Masks/alpha/scales are per-handler support
declarations. Unsupported/missing providers, invalid configuration or input and
unavailable backends fail deterministically; there is no fallback. Discovery and
configuration inspection perform no I/O. Explicit readiness does not cache or
replace execution validation. The saved settings adapter reads existing keys
without changing, silently repairing or enabling anything.

Providers receive copied pixels and validated primitive configuration. They cannot
receive editor/document/history/adapter authority through the input contract. M1
still owns execution slots, queues, revision/freshness, retained results and
terminal/late disposal. Feature adapters own containment, transient presentation,
explicit Accept and exact transactions. Cancel/stale/close revoke acceptance
immediately and keep the execution slot until the provider settles. Remove/Fill
insert one raster and history transaction; Expand changes canvas plus raster
atomically; Upscale opens a new unsaved document and leaves source history intact.

Review checked feature imports/configuration, transport duplication, per-request
state, disposal, cancellation and stale paths, alpha declarations, provenance,
settings and M10 replacement seams. Existing user-facing privacy/backend wording
is preserved. A future provider may update that explanatory copy while retaining
the existing UI state/authority.

No released-baseline defect requiring a product behavior change was found.
Two implementation hazards were fixed before acceptance and have regressions:

- Fill's resolved configuration is pinned for all candidates and Regenerate;
  retaining the caller's mutable selection would have allowed later candidates
  and provenance to target a different provider/model.
- Shared transport polling stops after Upscale download and ignores an already
  outstanding late status response. It cannot overwrite the local `Restoring
  transparency` stage, while AbortSignal cancellation remains live until assembly
  settles. This is a focused progress/lifetime correction, not a pixel change.

The baseline sampler, prompts/seeds, 512 minimum/multiple-eight padding, fixed
models, input/geometry classes, 1–3 Fill candidates, one Expand candidate, 4×
Upscale, preview/Accept and recipe-v1 privacy behavior are unchanged. Golden
padding receipts were calculated by executing the released `1e1421db` source
independently, then compared with M9 for odd and boundary dimensions.

## Automated and real-service evidence

| Lane | Final result |
| --- | --- |
| `npm test` | 2,196 passed, 424 suites, zero failed/skipped |
| `npm run lint` | PASS |
| `npm run verify` | PASS: imports, bindings, cycles, statics, shadows, prototypes, format wiring, bootstrap |
| `git diff --check` | PASS |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | PASS |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 25 passed; three opt-in real tests ignored by the default invocation |
| Same locked Rust tests with `real_ -- --ignored --test-threads=1` | All three real Fill/Expand/Upscale tests passed, one fresh small corpus case each |
| Native debug `.app` build | PASS, unsigned ARM64 development build |
| Exact packaged-runtime inspection | 717 assets; no missing, extra or changed assets; inline HTML/runtime links match |

The new 35 registry tests and three settings tests use the production registry,
M1 and feature adapters. They cover registration/discovery/resolution,
unsupported/missing/unavailable/configuration/error/input rejection, immutable
routing, explicit input/output contracts, current settings/loopback policy,
late output disposal, cancellation, stale mutation, supersession, closure,
Preview/Discard/Accept/history and cross-document isolation. Replacement-provider
fixtures exercise all four actual feature paths without model padding/configuration
in pixel input. These are deterministic architectural evidence, not real FLUX tests.
Existing tests were retained and none were skipped or weakened.

Rust tests cover literal loopback, owned leases/cancellation, prompt/fixed workflow,
geometry/model checks, protocol failure, redirect rejection, resource/PNG bounds,
response/timeouts and fake-service matrices. The three separate real tests use
native HTTP and the actual configured models; their single-case smoke corpora are
not a broad quality benchmark.

Local FileProvider conflict copies reappeared inside generated `dist/` and the
strict verifier correctly rejected extras. No verifier was relaxed. For this
acceptance build the same production `inventory/sourceBytes/verify` helpers staged
an exact closure under `/tmp/photosuite-m9-evidence/frontend`. An external Tauri
configuration pointed at that verified closure and disabled the redundant build
hook. Both locked Rust commands used the same external `frontendDist` override.
The executable was then independently decoded and compared with that inventory.
This is a local staging workaround, not a change to shipping packaging.

Native executable SHA-256:
`d8c720bcb06ac08a81b7e4a48fcc26e2f6a410cdaf9e76480f7f4ac4fb99ab94`
(248,435,896 bytes). It contains the final implementation commit's runtime sources.

## Real backend and native acceptance

Tested 2026-09-30 on Apple M5, 16 GiB RAM, macOS 27.0.1 (26A434), ARM64 Tauri
WebKit. The existing ComfyUI installation ran on literal `127.0.0.1:8188`,
version 0.37.4, source `8ff6dc384ba5c410266b40e137799e049459d4f2`, Python with
Torch 2.12.1 and MPS available. Native/backend execution directly used this host's
MPS path. No NVIDIA/Windows/Linux behavior is claimed.

Existing external weights were freshly hashed:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `sd-v1-5-inpainting.ckpt` | 4,265,437,280 | `c6bbc15e3224e6973459ba78de4998b80b50112b0ae5b5c67113d56b4e366b19` |
| `realesr-general-x4v3.pth` | 4,885,111 | `8dc7edb9ac80ccdc30c3a5dca6616509367f05fbc184ad95b731f05bece96292` |

The backend was initially stopped, started for owned acceptance runs with custom
nodes disabled, then stopped again. No existing model/runtime installation or
user preference was changed. Existing rights/provenance records remain applicable;
M9 makes no new redistribution claim.

The exact built `.app` was copied to a test-only identity clone because macOS
app registration selected a different installed PhotoSuite for its shared bundle
ID. Only `CFBundleIdentifier` and `CFBundleName` changed in the external clone;
the tested executable and embedded assets match the hash above.

Direct native controls exercised Fill's dialog, prompt/seed entry, Check backend,
Generate, visible preview and explicit Accept. The accepted layer and history
entry were visible. The complete four-workflow matrix used an external diagnostic
script entered through the actual native Web Inspector, importing packaged
production modules and using the real controller, default registry, M1, M0,
Tauri IPC and ComfyUI. It did not substitute providers or transport. This is native
instrumented execution; it is not a claim that every matrix action was clicked
through each feature dialog.

| Workflow | Available backend | Stopped backend |
| --- | --- | --- |
| Remove | Preview and Discard unchanged; Accept one layer/entry; source exact; zero changed RGBA bytes outside original selection; exact Undo/Redo | Readiness/submission fail; source/layers/history/geometry unchanged; no retained input/output |
| Fill | Same containment/transaction checks; passive original-model recipe retained; active-document switch isolated | Same clean unavailable failure |
| Expand | Preview/Discard unchanged; one atomic canvas/raster entry; 168×104 result; zero changed bytes in mapped original 128×96 rectangle; exact Undo/Redo | Same clean unavailable failure |
| Upscale | Preview/Discard unchanged; 512×384 ordinary new document; original source/history unchanged; correct 4× dimensions | Same clean unavailable failure |

All Accept cases ran after switching to another document; the other document
remained exact. Real Fill jobs cancelled, invalidated by source mutation and
closed during `Generating` settled as cancelled/stale with no preview/history
mutation or retained input/output. A real two-candidate Fill session completed
seeds 42/43 with the original model/profile despite deliberately mutating the
caller's provider, endpoint and checkpoint after submission. Accept retained seed
43 provenance and released the unused candidate. Regenerate pinning, supersession,
late/duplicate completion and malformed-output behavior additionally passed
production-path deterministic tests.

With ComfyUI stopped and connection refusal verified, **12 unique native-written
files** (PSD and PSB for the four workflows, direct UI Fill and pinned Fill) reopened
through the production parser/loader in native PhotoSuite. Geometry, layer names,
positions, layer pixel hashes and rendered composite hashes matched. Fill passive
recipes retained model/settings/seed while omitting prompts under the unchanged
default privacy policy. Native Undo/Redo for Remove/Fill/Expand also remained exact
offline. Reopen/history caused zero additional M1 provider submissions. Upscale
retains its baseline new-document behavior, not a source Undo entry.

Instrumentation counts M1 submissions; immutable Tauri `invoke` properties could
not be wrapped, so no raw-IPC counter claim is made. Source inspection plus the
unchanged M0/history/serialization tests support the no-inference architecture.
The matrix receipt includes duplicate direct-Fill save records from console input;
file reopening and hash receipts explicitly deduplicate the twelve actual paths.
Final job lists have no live or stopping work.

## M10 readiness, limits and deferred work

A replacement handler can adapt logical pixels to a modern runtime/model and
return the existing exact contract without changing transactions, M1 or feature
preview/Accept state. Executed replacement-provider tests establish that seam.
Actual FLUX.2 compatibility is **inferred as a design path and unverified as a
runtime**. No FLUX graph, weights, UI or transport was added.

M10 must implement its provider/configuration/profile, review runtime/hardware,
model rights, provisioning and fixed native transport security, and gather real
quality/performance acceptance. Recipe v1 only recognizes the reviewed M6 ComfyUI
workflow; future passive provenance needs its own schema review (or ordinary
pixels without recognized provenance). Instruction/reference operations need new
explicit contracts/UI. Different scales, native alpha, larger regions/context,
new input classes/candidate/geometry limits and downloads remain M10+ scope.

This evidence does not claim improved SD1.5/Real-ESRGAN quality, cross-platform
native runtime, signed/released packaging, hosted CI, broad real-model corpus,
total process/GPU memory cap or cold/warm performance qualification. Current
bounded geometry, input classes, conservative freshness, external-service retention
and model quality limitations remain. Rust security implementations were inspected
and exercised by current tests; this was not a new exhaustive security audit.

## Definition-of-done check

| # | Requirement | Evidence / result |
| --- | --- | --- |
| 1 | Stable provider/capability abstraction | Registry/neutral contracts; migrated production paths — PASS |
| 2 | v0.10.1 compatibility | Unchanged model/workflows/settings/authority; independent padding goldens — PASS |
| 3 | All four workflows migrated | Real native available/unavailable matrix — PASS |
| 4 | M0–M8 transactions intact | Existing suites plus native exact containment/history/save/reopen — PASS |
| 5 | M1 lifecycle authority intact | M1 unchanged; deterministic and real cancellation/stale/close/cleanup — PASS |
| 6 | Local security intact | Rust unchanged; endpoint/configuration and transport/security tests — PASS |
| 7 | Unsupported before execution | Registration/contract/resolution tests — PASS |
| 8 | Failure cannot mutate documents | Failure/malformed/unavailable tests and native receipts — PASS |
| 9 | Future providers preserve authority | Actual replacement-handler feature tests — PASS |
| 10 | Comprehensive abstraction/lifecycle coverage | 38 new tests plus unchanged full suites — PASS |
| 11 | Architecture/extension documented | README, plan and this acceptance report — PASS |
| 12 | M10 seam clear | Extension instructions and honest remaining seams — PASS |
| 13 | Required validation passes | Automated, locked Rust, real service, native and runtime receipts — PASS |
| 14 | Clean branch | Final commit/status check recorded in chat — PASS |
| 15 | No M10/model feature work | Scoped diff/commit review — PASS |

## Changed files

31 files; no Rust production source, M0 transaction, M1 scheduler or test baseline edits.

```text
docs/AI-ROADMAP.md
docs/m9/README.md
docs/m9/acceptance-receipt.json
docs/m9/acceptance.md
docs/m9/implementation-plan.md
docs/m9/package-inspection.json
src/core/app-settings.js
src/document/formats/metadata/generation-recipes.js
src/features/modernization/ai-capabilities.js
src/features/modernization/ai-providers.js
src/features/modernization/comfy-config.js
src/features/modernization/comfy-pixels.js
src/features/modernization/comfy-provider.js
src/features/modernization/comfy-request.js
src/features/modernization/expand-workload.js
src/features/modernization/generative-session.js
src/features/modernization/generative-workload.js
src/features/modernization/inpaint-config.js
src/features/modernization/inpaint-workload.js
src/features/modernization/provider-registry.js
src/features/modernization/selection-jobs.js
src/features/modernization/upscale-provider.js
src/features/modernization/upscale-target.js
src/features/modernization/upscale-workload.js
src/ui/dialogs/expand-dialog.js
src/ui/dialogs/generative-dialog.js
src/ui/dialogs/local-inpaint-settings.js
src/ui/dialogs/upscale-dialog.js
src/ui/shell/app-controller-ui-dispatch.js
tests/core/ai-provider-settings.test.js
tests/features/modernization/provider-registry.test.js
```
