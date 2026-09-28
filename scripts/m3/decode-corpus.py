"""Decode the versioned fixtures for evaluate.mjs (Pillow required)."""
from pathlib import Path
from PIL import Image
import json, shutil, sys

source = Path(__file__).resolve().parents[2] / 'tests/fixtures/subject-corpus/v1'
output = Path(sys.argv[1])
output.mkdir(parents=True, exist_ok=True)
shutil.copy2(source / 'manifest.json', output / 'manifest.json')
for item in json.loads((source / 'manifest.json').read_text())['cases']:
    (output / (item['id'] + '.bin')).write_bytes(Image.open(source / item['file']).convert('RGBA').tobytes())
