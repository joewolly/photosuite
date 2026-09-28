# M7 completion report

**Status: M7 acceptance complete.** Final rebuilt native bundle passed persistence, privacy, degradation and offline-open checks, including the pre-decode size guard, native privacy controls and zero-request backend sentinel. Local implementation commit is the delivery HEAD on `codex/m7-generation-recipes` (recorded in the accompanying delivery response). No push, merge, tag or release. Unrelated M5a work was preserved; test services were stopped and recipes-on/prompts-off preferences restored.

| Requested item | Result |
| --- | --- |
| 1. Starting branch/SHA | `codex/m6-generative-fill` / `ebaed1e86cb542b4fa271622a718d7abd4469ae5`. |
| 2. Final branch/SHA | `codex/m7-generation-recipes`; delivery HEAD contains the single M7 implementation commit above the exact accepted M6 SHA. |
| 3. Implementation commits | `feat: persist bounded generation provenance in PSD and PSB` (delivery HEAD). No push/merge/tag/release. |
| 4. Files | Listed below; no Rust changes. |
| 5–6. Namespace/schema | `https://photosuite.app/ns/generation/1.0/`; integer schema version 1. |
| 7. Persisted fields | Layer ID; recipe/workflow versions; operation; backend type; checkpoint filename; effective seed; completion timestamp; optional prompt; fixed effective settings/ROI/model dimensions; source ID/hash/geometry; selection hash/geometry; explicit selection-persistence `none`. Full schema in [README](README.md). |
| 8. Recipe/layer association | Unique positive uint32 PSD `lyid`, validated before editor ID repair. No index/name/stack-position association. |
| 9. Source identity | SHA-256 of original source RGBA plus source ID if unique, rectangle and document geometry. Informational local validation only. |
| 10. Selection persistence | No coverage bytes. Exact selection hash/bounds only. Corpus/compression study retained; worst case exceeds the entire metadata budget. |
| 11. Prompt privacy/default | Prompt saving off by default; recipe saving on. Explicit persisted preferences apply at every PSD/PSB serialization, including reopened files. |
| 12. Stripping | Turn off prompt saving or all recipe saving; Save As creates a stripped copy with ordinary layers intact. No flattening. |
| 13. Limits | Prompt 1,024 UTF-16 units/2,048 UTF-8 bytes; 64 accepted live records; 8 KiB decoded JSON each; 256 KiB escaped PhotoSuite metadata; 2 MiB XMP parse cap before UTF-8 decoding; zero saved coverage bytes. |
| 14. M6 Accept integration | Narrow optional metadata input to existing M0 preparation; unchanged raster transaction path, one history item. Provenance failure does not discard valid pixels. |
| 15. Candidate provenance | Selected candidate's actual seed/prompt/settings. Native B accepted with seed 43; A/C absent. |
| 16. Rename/reorder | Association retained by unique ID; automated and native save/reopen checks pass. |
| 17. Duplication | Policy B: normal raster copy, no copied provenance. |
| 18. Deletion/orphans | Serialize only live uniquely associated layers; deleted/undone layer records omitted, no document-level orphan list. |
| 19. Undo/Redo | Undo removes result and active recipe; Redo restores both from bounded private history, no generation. |
| 20. Save/reopen | Native PSD and PSB exact source/result/recipe with stopped backend. |
| 21. Unknown schema | Schema 999 ignored; ordinary raster remains exact; no execution or best-effort replay. |
| 22. Malformed metadata | Invalid XML/types/seeds/hashes, duplicates and oversized records/packets ignored safely. Native degradation checks, including the oversized fixture, pass. |
| 23. No-network proof | Automated fetch/XHR/native traps and native offline command/HTTP instrumentation all zero. External HTTP sentinel at the configured backend endpoint recorded zero requests throughout the final native checks. |
| 24. Provenance UI | Edit → Generative Info; prompt if retained, checkpoint explicitly labeled filename, workflow, seed, timestamp and disabled Regenerate with source/selection reason. |
| 25. Post-reopen Regenerate | Intentionally unavailable in v1 because exact selection is not saved. This is the specification's permitted decision gate. |
| 26. Stale/missing source | Clear “Original generation source no longer matches this recipe.” No current-composite substitution. |
| 27. Recipe after Regenerate | Live-session M6 Regenerate unchanged; whichever new candidate is accepted gets its own recipe. No saved-recipe execution path. |
| 28. PSD/PSB | Same resource 1060/schema path; native and deterministic pixel-exact round-trips. |
| 29. Independent/stripped compatibility | psd-tools 1.21.0 independently decodes ordinary `pixel` RGBA layer exactly in PSD, PSB and stripped/unknown/malformed PSD variants. No Adobe/recipe interoperability claim. |
| 30. Raw privacy evidence | Prompt string absent when disabled; prompt and namespace absent with all recipes disabled; exact raster preserved in both native tests. |
| 31. Automated tests | 2,071 passing; includes 30 new cases plus expanded M6 assertions. |
| 32. Required validation | `npm test`, `npm run lint`, `npm run verify`, `git diff --check`: pass. Rust unchanged; no extra Cargo unit suite required. Native debug bundle built successfully. |
| 33. Native acceptance | Real generation, candidate B, Info, privacy opt-in, persistence across restart, history, save/reopen, rename/reorder/duplicate/delete, stripping, source gates and degradation passed. Final rebuilt-bundle matrix, privacy controls and reopened Info passed; screenshots retained. |
| 34. Performance/package | 2,134-byte XMP packet. Native median save 9 ms and parse 5 ms with/without metadata. Unsigned debug app delta −20,096 bytes; build variability noted. No model/runtime assets added. |
| 35. Security findings | Focused review found no remaining M7 executable/network/credential path. DTD/entity rejection, size checks, whitelist JSON, text-only UI, unknown-schema ignore. Source hashes are not authenticity signatures. |
| 36. Limitations/deviations | Saved Regenerate gated; no Photoshop/Windows/Linux native check; generic XMP passthrough remains unsupported. One blocked existing native file-read was bypassed using identical /tmp fixtures and documented. |
| 37. Scope | M5a remains deferred; no M8, new model/provider, canvas expansion, format, layer type, cloud or C2PA work. |
| 38. Verdict | M7 complete: optional passive provenance survives PSD/PSB, privacy/degradation/offline behavior is green, ordinary raster pixels remain authoritative. |

## Files added

- `src/document/formats/metadata/generation-recipes.js`: bounded schema, privacy policy, layer association and passive source validation.
- `src/ui/dialogs/generative-info.js`: minimal provenance dialog.
- `tests/document/formats/metadata/generation-recipes.test.js`, `tests/core/generation-privacy.test.js`, `tests/helpers/xml-dom.js`: persistence/security/privacy coverage with a real XML parser.
- `docs/m7/`: schema, acceptance, this report and compact native/independent/compression/package evidence.

## Files modified

- `src/document/formats/metadata/xmp-metadata.js`, `src/document/formats/psd/psd-parser.js`, `src/document/formats/psd/psd-resource-parser.js`: deliberate XMP extension, PSD/PSB integration and fail-closed layer IDs.
- `src/features/modernization/generative-session.js`, `src/features/modernization/inpaint-target.js`, `src/features/trackers/exact-result-tracker.js`: accepted-candidate recipe and narrow history integration.
- `src/core/app-settings.js`, `src/core/event-bus.js`, `src/ui/dialogs/generative-dialog.js`, `src/ui/dialogs/local-inpaint-settings.js`, `src/ui/menu/menu-bar-file-edit-menus.js`, `src/ui/shell/app-controller-ui-dispatch.js`: explicit privacy and Info controls.
- `tests/features/modernization/generative.test.js`, `tests/document/formats/psd/psd-resource-parser.test.js`: M6/history/ID regressions.
- `package.json`, `package-lock.json`: test-only pinned XML parser; production assets unchanged.

Workspace: `/Users/joe/.codex/worktrees/m7-generation-recipes/PhotoSuite`. The original checkout's roadmap and untracked M5a directories were preserved.
