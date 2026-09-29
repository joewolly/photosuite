import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inventory, verify, root, allowedPath, sourceBytes, normalizeSourceBytes } from '../scripts/frontend-dist.mjs';

test('production inventory follows entry points, workers, binary loaders and license companions', () => {
  const files = inventory();
  for (const name of [
    'main.js', 'fonts/typr-worker.js', 'features/modernization/quick-select-worker.js',
    'features/modernization/subject-worker.js', 'features/modernization/prompted-worker.js',
    'vendor/pako/dist/pako.min.js', 'vendor/js-sha1/src/sha1.js',
    'vendor/onnxruntime/ort-wasm-simd-threaded.mjs', 'vendor/onnxruntime/ort-wasm-simd-threaded.wasm',
    'vendor/subject-model/birefnet-lite-512-fp16.onnx', 'vendor/prompted-model/encoder.onnx',
    'vendor/prompted-model/decoder.onnx', 'vendor/prompted-model/NOTICE',
    'vendor/wasm/harfbuzz/hb.wasm', 'vendor/wasm/fribidi/fribidi.wasm',
    'vendor/wasm/libheif/libheif.wasm', 'wasm/webp-encode.wasm',
    'features/filters/wasm/blur.wasm', 'features/filters/wasm/median.wasm',
    'resources/startup/brushes.abr', 'fonts/script/LICENSE-droid-sans-fallback.txt',
    'LICENSE', 'THIRD-PARTY-NOTICES.md',
  ]) assert.ok(files.has(name), name);
  for (const name of ['vendor/paper/.git', '.env', 'vendor/acorn/test/foo.js', 'vendor/js/typr/build.sh',
    'vendor/model/weights.ckpt', 'vendor/model/weights.safetensors', 'audit/result.json', 'evidence/run.log']) {
    assert.equal(allowedPath(name), false, name);
    assert.equal(files.has(name), false);
  }
});

test('verifier rejects additions, missing runtime assets, altered bytes and symlinks', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'photosuite-stage-test-'));
  try {
    for (const [name, source] of inventory()) {
      const target = path.join(stage, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, sourceBytes(source));
    }
    const before = verify(stage);
    for (const name of ['.git', '.env', 'vendor/paper/test/fake.js', 'extra.js', 'vendor/model.pth']) {
      const target = path.join(stage, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'prohibited');
      assert.throws(() => verify(stage));
      fs.rmSync(target);
      if (name.includes('/test/')) fs.rmSync(path.dirname(target), { recursive: true });
    }
    for (const name of ['vendor/onnxruntime/ort-wasm-simd-threaded.wasm', 'vendor/prompted-model/encoder.onnx', 'vendor/pako/dist/pako.min.js']) {
      const target = path.join(stage, name);
      const bytes = fs.readFileSync(target);
      fs.rmSync(target);
      assert.throws(() => verify(stage));
      fs.writeFileSync(target, 'wrong');
      assert.throws(() => verify(stage), /Changed staged bytes/);
      fs.writeFileSync(target, bytes);
    }
    // File symlinks work without elevated privileges on Unix. Windows checkout
    // behavior is independently rejected by the same lstat gate.
    if (process.platform !== 'win32') {
      const target = path.join(stage, 'main.js');
      fs.rmSync(target);
      fs.symlinkSync(path.join(root, 'src/main.js'), target);
      assert.throws(() => verify(stage), /Symlink/);
      fs.rmSync(target);
      fs.copyFileSync(path.join(root, 'src/main.js'), target);
    }
    assert.deepEqual(verify(stage), before);
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
});

test('staging normalizes Windows text line endings without touching binary data', () => {
  const crlf = Buffer.from('one\r\ntwo\r\n');
  assert.equal(normalizeSourceBytes('src/main.js', crlf).toString(), 'one\ntwo\n');
  assert.equal(normalizeSourceBytes('src/vendor/pako/LICENSE', crlf).toString(), 'one\ntwo\n');
  for (const source of ['model.onnx', 'runtime.wasm', 'font.ttf', 'preset.abr']) {
    assert.deepEqual(normalizeSourceBytes(source, crlf), crlf);
  }
});
