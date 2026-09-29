# Stabilization receipts

These are compact current-audit receipts, not substitutes for hosted checks or cross-platform runtime acceptance. See [the audit report](../modernization-integration-audit.md) for scope and limitations.

- `acceptance-summary.json`: final production commit, native final/offline/classic receipts, cleanup, performance, and validation counts. Native JSON snapshots hash complete raster buffers, not screenshots.
- `memory-summary.json`: attributed native process RSS and three mixed-model idle observations. Raw sampling began after earlier model use.
- `m8-history-memory.json`: synthetic generated pixels through production transactions; before/after snapshot bytes and GC-assisted trimming diagnostic. This is Node process memory, not native WebKit RSS.
- `independent-reader.json` and `transparent-composite-diagnostic.json`: psd-tools 1.21 file/pixel/bounds verification with explicit merged-image match flags. Transparent classic RGB differences are reported, not silently normalized.
- `package-assets.json`, `package-final.json`, `model-notices.json`: file sizes/hashes, package resources and unique model/runtime inventory.
- `hosted-ci.json`: read-only Actions API result. Zero workflows/runs is unavailable CI evidence, not a passing check.
- `changed-files.txt`: production-change manifest relative to accepted M8; excludes this later report/evidence commit.

Raw harnesses, command logs, native events, saved PSD/PSB fixtures, and a SHA-256 manifest are retained at `/Users/joe/Documents/Codex/2026-09-28/photosuite-stability-audit/`. Paths inside captured receipts refer to the original `/tmp/photosuite-stability-audit/` execution location; the same relative filenames exist in that durable directory. The first clone-history comparison failure lacked a captured differing snapshot; subsequent captured checks passed. Its cause remains unverified.

No audit server, backend process, memory sampler or native test app was left running.
