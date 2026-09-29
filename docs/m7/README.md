# M7 — Durable generation provenance

Pixels remain ordinary raster layers. PhotoSuite can save optional, passive generation provenance for accepted M6 Generative Fill results in PSD **and** PSB. Opening, rendering, selecting a layer, viewing its information, Undo and Redo never start/probe ComfyUI or require a model. M2–M5 results have no M7 records.

## User controls

**Edit → Generative Info…** displays provenance for the selected layer: prompt if retained, checkpoint **filename** (not a verified model hash), backend type, workflow, effective seed and generation completion time. Display uses text nodes, including imported prompts. Seeds do not guarantee identical results across models, runtimes, hardware or workflow revisions.

**Edit → Preferences → AI Remove → Generation metadata** has two independent save preferences:

- **Save generation recipes in PSD/PSB metadata**: on by default. Off omits all PhotoSuite generation metadata, including prompts.
- **Save generative prompts in PSD metadata**: off by default; also applies to PSB. On includes retained prompts; off strips them at serialization even for reopened files that contained them.

Save the preferences, then **Save As** to create a private copy. Existing files and external ComfyUI history are not erased. The ordinary layers are preserved without flattening. These are global save policies; they do not destructively edit in-memory recipes or add history items. A prompt already stripped from a file cannot be recovered by turning the preference on.

Only the two booleans enter application settings. Recipes live in a private layer-keyed WeakMap, outside layer `add`, document `xmpMetadata`, backup JSON and unrelated exports. The PSD writer constructs resource 1060 only for serialization and clears the temporary resource afterward. The reader consumes and removes it. No sidecars, prompt logs, model assets or backend URLs are added. Existing PSD-based autosave follows the same privacy policy.

## Selection/source decision gate

**Saved recipes are provenance-only in v1. Regenerate is disabled, even when the source matches.** M6 live-session Regenerate is unchanged. A fresh invocation of Generative Fill is a new operation and does not claim to reconstruct an old recipe.

M6 accepts exact 8-bit soft coverage, potentially 4 MiB for the original selection and 1 MiB within the ROI. Base64 alone adds a third; arbitrary coverage is not reliably compressible. A rectangle or binary mask cannot reconstruct soft coverage. Measurements of the 17 M6 fixtures found median 240,000 raw selection bytes and 1,184 zlib bytes (maximum compressed 2,650). A deterministic high-entropy 1 MiB ROI required 1,048,902 zlib bytes, already four times the entire metadata budget before base64. Favorable example compression is not a safe general bound. Consequently v1 saves no coverage bytes or source pixels, compressed or otherwise. It records SHA-256 of exact source RGBA and logical selection coverage (excluding alignment padding), geometry and source layer ID where unique. The info dialog checks the source locally and either explains that it no longer matches, or reports matching pixels but missing selection coverage. Neither outcome authorizes inference. Missing model/backend needs no probe because saved Regenerate is unavailable.

A future version that adds reconstruction must explicitly validate source, selection, geometry, reviewed workflow and current backend before running the existing pipeline. There is no “use current composite” fallback in v1.

## XMP schema v1

Namespace URI: **`https://photosuite.app/ns/generation/1.0/`**. Preferred prefix: **`photosuite`**. The URI is an identifier, never fetched. PhotoSuite owns this namespace; no Adobe namespace carries application-specific semantics.

Uses standard PSD/PSB image resource **1060**, UTF-8 XMP/RDF. `photosuite:schemaVersion` is integer **1**. `photosuite:recipes` is an ordered array of **Text** (`rdf:Seq` / `rdf:li`). Each text value is compact JSON matching the following whitelist. The JSON is declarative data, not a workflow. XML escaping applies after JSON encoding. An array item has no RDF resource URL, typed object, executable graph or arbitrary attributes.

```xml
<rdf:Description rdf:about="" xmlns:photosuite="https://photosuite.app/ns/generation/1.0/">
  <photosuite:schemaVersion>1</photosuite:schemaVersion>
  <photosuite:recipes><rdf:Seq>
    <rdf:li>{&quot;recipeVersion&quot;:1,...}</rdf:li>
  </rdf:Seq></photosuite:recipes>
</rdf:Description>
```

| Record field | Type / v1 meaning |
| --- | --- |
| `recipeVersion` | Integer 1. |
| `layerId` | Positive uint32 PSD `lyid` of accepted result; document-local, no authority. |
| `operation` | Exactly `generate.fill`. |
| `workflow` | Exactly `photosuite-generative-fill-v1`; installed app owns the reviewed graph. |
| `backend` | Exactly `comfyui`; type only, no endpoint/credentials/runtime-version claim. |
| `checkpoint` | Nonempty filename text, at most 240 UTF-8 bytes; filename is not cryptographic model identity. |
| `seed` | Effective accepted candidate seed, integer 0–4294967295. |
| `createdAt` | UTC ISO timestamp `YYYY-MM-DDTHH:mm:ss.sssZ`, captured when that candidate first reaches preview. |
| `prompt` | Optional exact effective prompt, including empty/whitespace/Unicode; absent means not retained. |
| `settings` | `steps:20`, `cfg:7`, `sampler:"euler"`, `scheduler:"normal"`, `denoise:1`, `maskGrowth:0`, ROI `{x,y,width,height}`, effective `modelWidth`/`modelHeight`. Negative conditioning is empty for this workflow. |
| `source` | Unique original source `layerId` or null; lowercase hex `sha256` of row-major RGBA8; layer `rect`; `documentWidth`/`documentHeight`. No filename/path/document UUID. |
| `selection` | Lowercase hex `sha256` of row-major original selection coverage8, plus its `rect`. Excludes alignment padding. |
| `selectionPersistence` | Exactly `none`. No reconstructable selection is implied. |

No model digest or actual runtime version is saved because M6 does not provide trustworthy per-result evidence for either. No application-version string is necessary to interpret the fixed workflow and recipe versions. No recipe UUID: unique layer ID already identifies the one accepted record.

### Bounds and normalization

Prompt: 1,024 UTF-16 units / 2,048 UTF-8 bytes, with invalid Unicode/XML control characters rejected. Records: **64**; only accepted live layers, never discarded/failed/unused candidates. Each decoded JSON text: **8 KiB**. Entire escaped PhotoSuite RDF description: **256 KiB**. XML packet parsing cap: **2 MiB**, checked before DOM parsing. Oversized packets/records are ignored; if the escaped output exceeds its limit, recipe metadata is omitted. A document with more than 64 associated layers saves the first 64 in current stack order. Pixels are never dropped to satisfy metadata limits.

Source/selection geometry is bounded by M6 (8,192 dimension / 4,194,304 pixels); document dimensions at most 32,768; ROI at most 1,024 per dimension; model dimensions must match M6's minimum-512, multiple-of-eight padding. Unknown fields are discarded. Unknown schema or recipe versions are ignored and not resaved. Invalid XML, DTD/entity declarations, wrong namespace, missing/type-invalid fields, malformed hashes, invalid seeds, nested RDF and ambiguous duplicate properties cannot authorize or trigger anything. General XMP passthrough remains outside scope.

## Identity and history

PSD layers are read before resource metadata. M7 binds only unique positive uint32 IDs as actually parsed; missing IDs are not synthesized for provenance. Duplicate IDs, duplicate recipe references, repeated `lyid` blocks, malformed `lyid` sizes, groups and wrong/missing references do not bind. Rename, reorder and ordinary grouping preserve the same layer object/ID. Copy/duplicate uses normal raster cloning and **omits** provenance (policy B). Delete and Undo remove layers from the save candidate set; there is no accumulating document-level orphan list. Undo of deletion can retain provenance when the original layer object is restored.

M6 supplies the selected candidate's actual seed/prompt/settings to a narrow optional M0 preparation parameter. The private history state snapshots the sanitized record along with the raster result. Accept remains one history item; Undo removes the layer and hence its active association; Redo restores both without generation. Hashing runs locally alongside generation and settles before Accept becomes available. A hashing/normalization failure preserves valid pixels and shows a precise provenance failure notice. No global history engine rewrite.

## Compatibility and security

A PSD/PSB without M7 XMP renders identically. Another application may retain or strip the namespace; it is not expected to interpret recipes. No Adobe generative-layer compatibility or C2PA claim is made. Independent-reader results and native acceptance are recorded in [acceptance.md](acceptance.md).

The parser and normalizer import no provider, filesystem or network API. They never interpret paths/URLs/commands/graphs. JSON is parsed into a whitelist; there is no eval or dynamic module selection from metadata. The info UI has no enabled saved-recipe execution path. Text cannot become HTML. SHA-256 identifies source bytes, not authorship or tamper-proof provenance; an edited file can forge provenance. No credentials are saved.

XMP design follows [Adobe's XMP data model and serialization specification](https://developer.adobe.com/xmp/docs/xmp-specifications/) and [XMP Text/array types](https://developer.adobe.com/xmp/docs/xmp-namespaces/xmp-data-types/). Test-only `@xmldom/xmldom` is MIT-licensed and outside the packaged `src` tree; production uses the native DOMParser. No model/runtime dependency or license changed. M5a remains deferred; no M8 work is included.
