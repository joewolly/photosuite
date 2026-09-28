# Prompt quality evidence

Eleven bounded fixture categories, five **predeclared** prompt configurations per
fixture, using final bundled weights and production reconstruction in ORT Web
WASM. See the [manifest](../../tests/fixtures/prompted-corpus/v1/manifest.json) for
image hashes, licenses, exact points and boxes. Four photographs are reused from
M3; derivatives are correlated, and the person/person occlusion is a rectangular
composite rather than a natural crowded photo. This is a regression/acceptance
corpus, not an independent segmentation benchmark.

Ground truth exists only for the five geometric synthetic cases. IoU uses coverage
≥128. Boundary F is symmetric boundary precision/recall with a two-source-pixel
Chebyshev tolerance; it is not an alpha-matting score. All mask PNGs, including
failures, are retained beside the contact sheets.

| Fixture | Point IoU / BF | +negative | Box | Box+positive | Multiple | Point→multiple IoU |
|---|---:|---:|---:|---:|---:|---:|
| isolated | 0.276 / 0.000 | 0.276 / 0.000 | 0.999 / 1.000 | 0.999 / 1.000 | 0.995 / 0.937 | +0.720 |
| neighbors | 0.276 / 0.000 | 0.276 / 0.000 | 0.999 / 1.000 | 0.998 / 0.953 | 0.995 / 0.990 | +0.720 |
| hole | 0.996 / 1.000 | 0.993 / 1.000 | 0.994 / 1.000 | 0.993 / 1.000 | 0.991 / 1.000 | -0.005 |
| thin | 0.998 / 1.000 | 0.980 / 0.988 | 0.997 / 1.000 | 0.998 / 1.000 | 0.998 / 1.000 | -0.000 |
| occluded-object | 0.225 / 0.161 | 0.225 / 0.160 | 0.779 / 0.830 | 0.775 / 0.842 | 0.990 / 0.900 | +0.765 |

Boxes and targeted positive corrections recover the complete bottle from an
ambiguous label click, distinguish the left of two similar products, and recover
the visible occluded bottle (0.225→0.990 IoU). Thin chair structure and ring holes
are already strong on the first point; extra prompts can slightly worsen them.
The occluded bottle box alone misses a separated visible piece; multiple prompts
recover it. Corrections are **not monotonic** and predicted IoU is not a quality
guarantee. Review before Accept; Discard/New object and classical tools remain
available. There is no hidden smoothing to disguise these failures.

| Photograph / stress case | Observed behavior | Evidence |
|---|---|---|
| Two people | First point and box isolate the intended left person. A negative point on the neighbor unexpectedly removes the shirt; box and positive correction restore it. | [contact](evidence/people-contact.jpg) |
| Person occlusion composite | Point favors the visible suit; box and head correction restore the intended rear person's head/body and exclude the front insert. Synthetic occlusion limits realism. | [contact](evidence/occluded-person-contact.jpg) |
| Cluttered cup/table | Point selects part of cup exterior. Box/positive point recover rim/interior/handle, with uncertain spoon/edge coverage. Targeted native negative spoon click reduces coverage there. Still needs review/refinement. | [contact](evidence/table-contact.jpg) |
| Fur | Useful coarse cat isolation; negative point removes background. Boxes can include more background and whiskers are incomplete. Not fine alpha matting. | [contact](evidence/fur-contact.jpg) |
| Low contrast | Coarse cup recovered despite contrast reduction; boundary/spoon remain imperfect and more prompts are not uniformly better. | [contact](evidence/low-contrast-contact.jpg) |
| Image boundary | Cat can reach image edges without padding/coordinate shifts; negative prompts reduce background but fine fur remains limited. | [contact](evidence/boundary-contact.jpg) |

Other contact sheets: [isolated](evidence/isolated-contact.jpg),
[neighbors](evidence/neighbors-contact.jpg), [ring](evidence/hole-contact.jpg),
[chair](evidence/thin-contact.jpg), [occluded object](evidence/occluded-object-contact.jpg).

The native app separately ran all eleven images with four accumulated states:
positive, positive+negative, those points+box, then an additional positive. This
is **44 real native previews**, and is deliberately distinguished from the 55
independent configurations above. Source pixels, selection and history were
checked at every preview. Native masks and timings are retained in the evidence
folder. Actual UI clicks/drag/dropdown additionally tested coffee positive,
Discard, box, positive and negative corrections, Accept and Refine Edge preview.

A separate native positive-only correction (no box) restored the bottle cap from
coverage 0 to 254 while the previously selected body stayed at 249 (initially
255). See `offline-positive-restores` in native-events.jsonl and the native
positive-correction mask. This isolates recovery by an additional include point.

These results support useful user-directed object selection with review. They do
not establish universal correction improvement, natural crowd/occlusion accuracy,
large-image downsampling quality, or production alpha extraction.
