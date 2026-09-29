# M7 validation — 2026-09-28

Local macOS evidence only. No hosted CI, signed release, Photoshop acceptance, Windows or Linux native acceptance is claimed. Rust source is unchanged. Ordinary tests require no ComfyUI.

## Automated

`npm test`, `npm run lint`, `npm run verify`, and `git diff --check` passed. The final count is recorded in the completion report. Coverage includes:

- Real XML parser round-trip, namespace aliases, strict schema, Unicode/escaping/multiline prompts, malformed XML, DTD/entity rejection, nested RDF, invalid types/seeds/hashes and unknown versions.
- Prompt units/bytes, record-count and escaped-metadata limits, oversized packet rejection before UTF-8 decoding.
- Correct chosen candidate B seed/settings; only B accepted, A/C discarded. One history item. Exact layer/recipe Undo/Redo without inference. Hash failure preserves pixels with a precise notice.
- Unique layer IDs; rename/reorder/group placement; duplicate names; duplicate omits recipe; deletion/orphan removal; missing/wrong/duplicate IDs and duplicate recipe records; malformed/repeated PSD layer ID blocks.
- Actual PSD and PSB serializers/parsers; exact source/result/composite bytes; deliberately stripped resource 1060; unknown schema/invalid recipe degradation; no fetch, XHR or native backend invocation during open.
- Default-off prompts, explicit retention, raw-byte prompt absence, full recipe stripping, private-state isolation and failed writer cleanup.
- Valid, stale and missing source checks; all saved recipes unavailable for Regenerate because exact selection coverage is intentionally absent.
- Settings store receives only privacy booleans, restores them without backend contact and preserves active policy if a save fails.

`@xmldom/xmldom` 0.9.12 is a dev-only test dependency; no new production runtime is added.

## Native application

The actual packaged, unsigned debug Tauri app ran at `/tmp/photosuite-m7-target/debug/bundle/macos/PhotoSuite.app`. CUA controlled the native menus/dialogs. A guarded external Web Inspector harness used the live AppController, normal M6 provider/Rust bridge, M0 history, PSD serializer, native file write and actual FileProcessor loader. It did not replace inference or accepted bytes. Generated test assets and detailed logs remain outside the repository under:

`/Users/joe/Documents/Codex/2026-09-28/photosuite-m7-acceptance/`

| Check | Observed evidence |
| --- | --- |
| Real M6 generation | Direct Edit → Generative Fill, synthetic coffee-mug prompt, seed 42, three variations. Explicit backend check confirmed existing ComfyUI 0.37.4. Direct Generate ran three real jobs. |
| Accepted candidate | Direct B then Accept. Provenance UI displayed effective seed **43**, exact prompt, checkpoint filename and workflow. One accepted record; ordinary raster layer. |
| User privacy controls | Preferences → AI Remove showed recipes on, prompts off. Direct prompt opt-in and Save generation privacy succeeded; a fresh process restored the setting. Final UI toggles verified prompt stripping and full recipe stripping against saved raw bytes and exact pixels, then restored recipes on/prompts off. |
| Undo/Redo | Exact result/recipe restored; source unchanged. History length 3/index 2 consists of Open, fixture selection, one Generative Fill. No inference on replay. |
| PSD and PSB save/reopen | Both saved from native serializer and reopened through actual file loader with ComfyUI stopped. Exact pixels and exact retained recipe. |
| No backend on open | Backend process stopped, connection refusal verified. Instrumented offline matrix observed **0 native backend commands and 0 backend HTTP calls**. Final native reopen matrix also recorded zero backend commands; an independent HTTP sentinel listening at the configured endpoint logged zero requests through all ten opens and UI checks. |
| Rename/reorder | Saved/reparsed native document retained correct association by ID. |
| Duplicate/delete | Duplicate pixels retained, duplicate provenance absent. Deleting original generated layer removed its recipe from saved metadata. |
| Prompt stripping | Native serialized bytes lacked synthetic prompt; reopened recipe had no prompt; exact generated pixels. |
| Full recipe stripping | Namespace and prompt absent from native PSD; reopened pixels exact, no recipe. |
| Degradation | Final native loader opened resource-stripped, schema 999, malformed XML, invalid seed, malformed hash and oversized XMP fixtures. Source/result bytes exact; recipe absent. |
| Source validation | Matching source explained selection gate; changed and missing source returned “Original generation source no longer matches this recipe.” No current-composite substitution. |
| Saved Regenerate | Disabled in native Generative Info, with explicit selection-persistence reason. No post-reopen inference implementation is claimed. Live-session M6 Regenerate remains covered by regression tests. |
| Writer failure | Final native injected serialization failure left no private XMP resource in document resources. |

Accepted result ROI: `{x:91,y:0,width:393,height:384}`. SHA-256:

- Source: `2c9022e5a85bd6baa1679a11f91fa94fd1d69ba879414f5da7c55066ea3b28fc`
- Accepted B raster: `0527d8da3a88bf6aea9eeaf385641e4c873fe397bbf569172791648186a229bc`
- Native composite: `b7bb1c48619407a1e6e1931f36aa6335a45fe952b66a1a894843357cf16cd313`

Native logs include a diagnostic interruption: the host was observed blocked in its existing synchronous `read_file_raw` file-open syscall for an externally created fixture under Documents. Acceptance resumed in a fresh process using byte-identical `/tmp` fixtures, and the degradation matrix passed. No Rust behavior was changed and no root cause beyond the observed blocked file read is asserted. A later macOS lock interrupted the last rebuilt-bundle checks; after unlock those checks all passed.

## Independent compatibility

`psd-tools` **1.21.0**, installed only in `/tmp/photosuite-m7-psdtools`, read the saved PSD and PSB and classified the generated layer as `kind: pixel`, RGBA, 393×384. Its decoded RGBA SHA-256 matched the exact native accepted result above. Resource-stripped, unknown-schema and malformed-XML PSD variants yielded the same ordinary raster and exact hash. No recipe interoperability claim is made. Adobe Photoshop was not used.

An initial Pillow-only layer probe did not provide matching canonical ROI pixels; it is not used as byte-exact evidence. The independent psd-tools decode supersedes that probe.

## Performance / package

Native millisecond-resolution measurements, one 600×400 document / one record. Not percentiles or general large-document guarantees:

| Operation | Samples | Median | Maximum |
| --- | ---: | ---: | ---: |
| Recipe normalization | 100 | <1 ms | 1 ms |
| XMP encode | 100 | <1 ms | 1 ms |
| XMP parse | 100 | <1 ms | 1 ms |
| PSD save with metadata | 30 | 9 ms | 11 ms |
| PSD save without metadata | 30 | 9 ms | 12 ms |
| PSD parse with metadata | 30 | 5 ms | 6 ms |
| PSD parse without metadata | 30 | 5 ms | 7 ms |

XMP packet: **2,134 bytes**. Retained PSD: **1,671,910 bytes**; PSB: **1,680,622 bytes**. Source hashes are computed once alongside explicit generation; normal save/open does not hash raster pixels. Opening Generative Info can hash the bounded source locally. Results show no measured median save/parse overhead for this fixture.

Local unsigned debug bundle logical size: baseline **279,319,974 bytes**, M7 **279,299,878 bytes**, delta **−20,096 bytes**. This is an observed bundle comparison, not a claim that M7 code reduces application size; compiler paths/build variability can affect binaries. No model, backend or production dependency asset was added.

## Security review

Persisted data is a whitelist of primitives and bounded geometry/hashes. JSON is never executed. Namespace URIs, checkpoint text and unknown values are never fetched or interpreted as commands. DTD/entity-bearing XML is rejected before parsing. Optional data is discarded on malformed/unknown/ambiguous input while raster data remains usable. Prompts render through `textContent`. Recipe storage cannot start ComfyUI, invoke arbitrary graphs, read files, access credentials or contact a provider. SHA-256 is source identity, not a provenance-authenticity signature. No exploitable M7 security finding remains from the focused review; this is not an exhaustive audit of the entire editor.

Final native UI captures: [reopened Generative Info](native-info.png) and [recipe stripping controls](native-privacy.png). [Backend sentinel receipt](backend-sentinel.json) records the independent zero-request check.
