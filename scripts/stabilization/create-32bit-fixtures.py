"""Reproducible tiny layered PSDs: real zlib, Lr32 records, two float rows.

No PhotoSuite serializer is used. Values deliberately exercise RGB8 clamping.
"""
from pathlib import Path
import struct
import zlib

OUT = Path(__file__).resolve().parents[2] / 'tests/fixtures/psd-32bit'
W, H = 4, 2
VALUES = [0, .25, .5, 1, -.5, 2, .75, .125]

def u16(n): return struct.pack('>H', n)
def u32(n): return struct.pack('>I', n)
def tag(key, payload): return b'8BIM' + key + u32(len(payload)) + payload + bytes(-len(payload) % 4)
def samples(values): return b''.join(struct.pack('>f', v) for v in values)
def channel(values, compression):
    raw = samples(values)
    if compression == 3:
        result = bytearray()
        for y in range(H):
            row = raw[y * W * 4:(y + 1) * W * 4]
            planar = bytes(row[x * 4 + p] for p in range(4) for x in range(W))
            result.extend(bytes([planar[0]]) + bytes((planar[i] - planar[i - 1]) % 256 for i in range(1, len(planar))))
        raw = zlib.compress(result)
    return u16(compression) + raw

def make(compression):
    records, pixels = [], []
    for name, lid, values in [(b'Float top', 42, VALUES), (b'Float base', 43, [.5] * 8)]:
        channels = [channel(values, compression) for _ in range(3)] + [channel([1] * 8, compression)]
        name_data = bytes([len(name)]) + name
        name_data += bytes(-len(name_data) % 4)
        extra = u32(0) + u32(0) + name_data + tag(b'lyid', u32(lid))
        record = struct.pack('>iiiiH', 0, 0, H, W, 4)
        record += b''.join(struct.pack('>hI', cid, len(data)) for cid, data in zip([0, 1, 2, -1], channels))
        record += b'8BIMnorm' + bytes([255, 0, 0, 0]) + u32(len(extra)) + extra
        records.append(record)
        pixels.extend(channels)
    layer_list = struct.pack('>h', 2) + b''.join(records + pixels)
    layer_list += bytes(-len(layer_list) % 4)
    # Empty standard Layer Info, then global mask and deep-colour records.
    section = u32(0) + u32(0) + tag(b'Lr32', layer_list)
    header = b'8BPS' + u16(1) + bytes(6) + u16(3) + u32(H) + u32(W) + u16(32) + u16(3)
    composite = u16(0) + samples(VALUES) * 3
    return header + u32(0) + u32(0) + u32(len(section)) + section + composite

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for compression, name in [(0, 'raw'), (3, 'zip-prediction')]:
        path = OUT / f'layered-{name}.psd'
        path.write_bytes(make(compression))
        print(path.name, path.stat().st_size)
