# Adapted from CoderViking/birefnet-lite-onnx @ dc06453148f01ef4131f17e9b791345e32e8ee78 (MIT).
# See docs/m3/model-provenance.json and src/vendor/subject-model/LICENSE.
#!/usr/bin/env python
"""Developer-only export of the pinned official MIT BiRefNet-lite checkpoint.

Static 512x512, per-tap GridSample deformable convolution, opset 17, then
fp16 weights with float32 IO. PhotoSuite ships only ONNX Runtime Web WASM.
Verifies deformable convolution and full FP32 model parity before conversion.
See docs/m3/README.md for provisioning and exact dependency versions.

Usage: python scripts/m3/export-subject-model.py --source /path/to/pinned-snapshot
"""
import argparse
import sys

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

REPO = 'ZhengPeng7/BiRefNet_lite'
REVISION = 'aa62cd87eafb9cc43056d08ef3615a14628b831d'


def grid_sample_deform_forward(self, x):
    """Drop-in for DeformableConv2d.forward (birefnet.py) built on GridSample.

    Equivalent to torchvision.ops.deform_conv2d(input, offset, weight, bias,
    stride=1, padding=p, mask=modulator): for kernel tap k at (i, j) the op
    samples x at (y + i - p + dy_k, x + j - p + dx_k) bilinearly with zero
    padding, scales by the modulation mask, and accumulates W[:, :, i, j] as a
    1x1 conv. Offsets are interleaved (dy, dx) per tap, row-major over the
    kernel, matching torchvision's layout.
    """
    offset = self.offset_conv(x)                       # [B, 2K, H, W]
    modulator = 2.0 * torch.sigmoid(self.modulator_conv(x))  # [B, K, H, W]
    B, C, H, W = x.shape
    kh, kw = self.regular_conv.kernel_size
    pad = self.padding
    weight = self.regular_conv.weight                  # [Cout, Cin, kh, kw]

    ys = torch.arange(H, dtype=x.dtype, device=x.device)
    xs = torch.arange(W, dtype=x.dtype, device=x.device)
    base_y, base_x = torch.meshgrid(ys, xs, indexing='ij')  # [H, W] constants
    # pre-normalized base grids (grid_sample align_corners=False convention);
    # keeping the per-tap shift on the dynamic offset lets constant folding
    # share ONE [H, W] grid pair per resolution instead of one per kernel tap
    norm_y = (2 * base_y + 1) / H - 1
    norm_x = (2 * base_x + 1) / W - 1

    out = None
    for k in range(kh * kw):
        i, j = divmod(k, kw)
        py = norm_y + (offset[:, 2 * k] + (i - pad)) * (2.0 / H)   # [B, H, W]
        px = norm_x + (offset[:, 2 * k + 1] + (j - pad)) * (2.0 / W)
        grid = torch.stack([px, py], dim=-1)
        sampled = F.grid_sample(x, grid, mode='bilinear', padding_mode='zeros',
                                align_corners=False)
        sampled = sampled * modulator[:, k:k + 1]
        contrib = F.conv2d(sampled, weight[:, :, i, j].unsqueeze(-1).unsqueeze(-1))
        out = contrib if out is None else out + contrib
    if self.regular_conv.bias is not None:
        out = out + self.regular_conv.bias.view(1, -1, 1, 1)
    return out


def verify_deform_patch(deform_cls):
    """Random-weight equivalence check: patched forward vs torchvision op."""
    from torchvision.ops import deform_conv2d
    torch.manual_seed(0)
    worst = 0.0
    for ksize, pad in [(1, 0), (3, 1), (7, 3)]:
        m = deform_cls(8, 16, kernel_size=ksize, padding=pad, bias=False)
        for p in m.parameters():  # zero-init offsets would hide layout bugs
            nn.init.normal_(p, std=0.3)
        x = torch.randn(1, 8, 20, 24)
        with torch.no_grad():
            offset = m.offset_conv(x)
            modulator = 2.0 * torch.sigmoid(m.modulator_conv(x))
            ref = deform_conv2d(x, offset, m.regular_conv.weight,
                                m.regular_conv.bias, padding=pad,
                                mask=modulator, stride=m.stride)
            got = grid_sample_deform_forward(m, x)
        worst = max(worst, (ref - got).abs().max().item())
    return worst


class LogitsWrapper(nn.Module):
    """BiRefNet eval-forward returns a list of multi-scale preds; the last one
    is the full-resolution logits map the demo pipeline consumes."""

    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, input_image):
        return self.net(input_image)[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=512)
    ap.add_argument('--out', default='birefnet-lite-512-fp16.onnx')
    ap.add_argument('--source', required=True, help='Local snapshot of the pinned official repository')
    args = ap.parse_args()

    import hashlib
    from pathlib import Path
    import json
    if args.size != 512:
        raise ValueError('Only the reviewed 512x512 contract is supported')
    provenance = json.loads((Path(__file__).resolve().parents[2] / 'docs/m3/model-provenance.json').read_text())
    for name, expected in provenance['sourceFilesSha256'].items():
        if hashlib.sha256((Path(args.source) / name).read_bytes()).hexdigest() != expected:
            raise ValueError('Pinned source mismatch: ' + name)
    from transformers import AutoModelForImageSegmentation
    torch.set_grad_enabled(False)
    model = AutoModelForImageSegmentation.from_pretrained(
        args.source, local_files_only=True, trust_remote_code=True)
    model.eval().float()
    birefnet_mod = sys.modules[type(model).__module__]

    # reference logits from the unpatched model (torchvision deform_conv2d)
    torch.manual_seed(1)
    probe = torch.rand(1, 3, args.size, args.size)
    ref_logits = LogitsWrapper(model)(probe)

    deform_err = verify_deform_patch(birefnet_mod.DeformableConv2d)
    print(f'deform patch vs torchvision: max abs dev {deform_err:.3e}')
    assert deform_err < 1e-4, 'GridSample decomposition diverges from torchvision'

    birefnet_mod.DeformableConv2d.forward = grid_sample_deform_forward
    patched_logits = LogitsWrapper(model)(probe)
    patch_err = (ref_logits - patched_logits).abs().max().item()
    print(f'patched model vs reference: max abs logits dev {patch_err:.3e}')
    assert patch_err < 1e-3

    torch.onnx.export(
        LogitsWrapper(model),
        (probe,),
        args.out,
        input_names=['input_image'],
        output_names=['output_image'],
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )

    # The TorchScript trace leaves the (all-constant, static-shape) Swin
    # attention-mask construction as live ScatterND/Where/Shape chains;
    # onnxslim folds them into initializers.
    # FusionGemm is skipped so the shared (deduped) MatMul weights are not
    # re-split into per-call-site transposed Gemm copies.
    import onnxslim
    onnxslim.slim(args.out, output_model=args.out,
                  skip_fusion_patterns=['FusionGemm'])

    # The backbone is traced twice (multi-scale 'cat' input), and the
    # TorchScript exporter emits one initializer per call site - every Swin
    # weight lands in the file twice (+116 MB). Dedupe by content hash.
    import hashlib
    import onnx
    m = onnx.load(args.out)
    canonical, rename = {}, {}
    keep = []
    for init in m.graph.initializer:
        arr = onnx.numpy_helper.to_array(init)
        h = (str(arr.dtype), arr.shape,
             hashlib.sha256(arr.tobytes()).hexdigest())
        if h in canonical:
            rename[init.name] = canonical[h]
        else:
            canonical[h] = init.name
            keep.append(init)
    del m.graph.initializer[:]
    m.graph.initializer.extend(keep)
    for node in m.graph.node:
        for idx, name in enumerate(node.input):
            if name in rename:
                node.input[idx] = rename[name]
    print(f'deduped {len(rename)} duplicate initializers')
    onnx.save(m, args.out)

    import onnx
    from collections import Counter
    m = onnx.load(args.out, load_external_data=False)
    ops = Counter(n.op_type for n in m.graph.node)
    print('ops:', sorted(ops.items(), key=lambda kv: -kv[1]))
    for banned in ('GatherND', 'ScatterND', 'Clip'):
        assert banned not in ops, f'{banned} in graph - not browser-clean'

    import onnxruntime as ort_rt
    sess = ort_rt.InferenceSession(args.out, providers=['CPUExecutionProvider'])
    onnx_logits = sess.run(None, {'input_image': probe.numpy()})[0]
    onnx_err = np.abs(ref_logits.numpy() - onnx_logits).max()
    alpha_err = np.abs(torch.sigmoid(ref_logits).numpy()
                       - 1 / (1 + np.exp(-onnx_logits))).max()
    print(f'onnx vs torch reference: max abs logits dev {onnx_err:.3e}, '
          f'max sigmoid dev {alpha_err:.3e}')

    assert onnx_err < 1e-3
    from onnxconverter_common import float16
    half = float16.convert_float_to_float16(onnx.load(args.out), keep_io_types=True)
    onnx.save(half, args.out)
    print('final sha256:', hashlib.sha256(Path(args.out).read_bytes()).hexdigest())

if __name__ == '__main__':
    main()
