"""Developer-only SAM 2.1 image export. No downloader or Python runtime ships.

python scripts/m4/export-sam2.py --work /tmp/photosuite-m4-evaluation
The work directory must contain pinned sam2/, ort-export/, and the checkpoint.
Microsoft wrappers retain their own MIT notices in the supplied source tree.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--work', type=Path, required=True)
args = parser.parse_args()
work = args.work.resolve()
provenance = json.loads((Path(__file__).parents[2] / 'docs/m4/model-evaluation.json').read_text())
assert subprocess.check_output(['git', '-C', str(work / 'sam2'), 'rev-parse', 'HEAD'], text=True).strip() == provenance['codeRevision']
assert not subprocess.check_output(['git', '-C', str(work / 'sam2'), 'status', '--porcelain'], text=True).strip()
checkpoint = work / provenance['checkpoint']
assert hashlib.sha256(checkpoint.read_bytes()).hexdigest() == provenance['checkpointSha256']
for name, digest in provenance['conversionSourceSha256'].items():
    assert hashlib.sha256((work / 'ort-export' / name).read_bytes()).hexdigest() == digest, name
sys.path[:0] = [str(work / 'sam2'), str(work / 'ort-export')]

import numpy as np
import torch
import onnx
import onnxruntime as ort
from sam2.build_sam import build_sam2
from image_encoder import SAM2ImageEncoder
from prompt_encoder import SAM2PromptEncoder
from mask_decoder import SAM2MaskDecoder

torch.set_num_threads(4)
torch.manual_seed(0)
model = build_sam2('configs/sam2.1/sam2.1_hiera_t.yaml', str(checkpoint), device='cpu').eval()

class Decoder(torch.nn.Module):
    """One object, accumulated points/box, no recurrent mask or video state."""
    def __init__(self):
        super().__init__()
        self.prompt = SAM2PromptEncoder(model)
        self.mask = SAM2MaskDecoder(model, multimask_output=True)

    def forward(self, features0, features1, embedding, points, labels):
        sparse, dense, pe = self.prompt(points, labels, torch.zeros(1, 1, 256, 256), torch.zeros(1))
        masks, scores, _, _ = self.mask.mask_decoder.predict_masks(
            image_embeddings=embedding, image_pe=pe, sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=dense, repeat_image=False, high_res_features=[features0, features1])
        return masks, scores

with torch.inference_mode():
    image = torch.randn(1, 3, 1024, 1024)
    encoder = SAM2ImageEncoder(model).eval()
    features = encoder(image)
    decoder = Decoder().eval()
    points = torch.tensor([[[512., 512.], [200., 200.]]])
    labels = torch.tensor([[1, 0]], dtype=torch.int32)
    decoder_inputs = (*features, points, labels)
    outputs = decoder(*decoder_inputs)
    names = ['image_features_0', 'image_features_1', 'image_embeddings']
    torch.onnx.export(encoder, image, str(work / 'encoder.onnx'), opset_version=17,
                      input_names=['image'], output_names=names)
    torch.onnx.export(decoder, decoder_inputs, str(work / 'decoder.onnx'), opset_version=17,
                      input_names=names + ['point_coords', 'point_labels'],
                      output_names=['low_res_masks', 'iou_predictions'],
                      dynamic_axes={'point_coords': {1: 'points'}, 'point_labels': {1: 'points'}})
    records = {}
    for component, inputs, expected in [('encoder', {'image': image.numpy()}, features),
                                       ('decoder', dict(zip(names + ['point_coords', 'point_labels'], [t.numpy() for t in decoder_inputs])), outputs)]:
        path = work / (component + '.onnx')
        onnx.checker.check_model(str(path))
        session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
        actual = session.run(None, inputs)
        records[component] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                              'maxAbsError': [float(np.max(np.abs(a - b.numpy()))) for a, b in zip(actual, expected)]}
        print(component, records[component], flush=True)
    (work / 'conversion.json').write_text(json.dumps(records, indent=2) + '\n')
    # Store only weight initializers in FP16; every computational edge stays FP32.
    # General graph FP16 conversion is not compatible with this WASM export.
    storage_records = {}
    for component in ['encoder', 'decoder']:
        graph = onnx.load(work / (component + '.onnx'))
        casts = []
        for i, tensor in enumerate(graph.graph.initializer):
            if tensor.data_type != onnx.TensorProto.FLOAT:
                continue
            original = tensor.name
            stored = original + '__storage_fp16'
            values = onnx.numpy_helper.to_array(tensor).astype('float16')
            graph.graph.initializer[i].CopyFrom(onnx.numpy_helper.from_array(values, stored))
            casts.append(onnx.helper.make_node('Cast', [stored], [original], to=onnx.TensorProto.FLOAT, name=stored + '__restore'))
        nodes = list(graph.graph.node)
        del graph.graph.node[:]
        graph.graph.node.extend(casts + nodes)
        onnx.checker.check_model(graph)
        path = work / (component + '-fp16.onnx')
        onnx.save(graph, path)
        storage_records[component] = {'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    (work / 'fp16.json').write_text(json.dumps(storage_records, indent=2) + '\n')
    print(storage_records, flush=True)
