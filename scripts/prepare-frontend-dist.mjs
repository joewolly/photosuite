#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { root, dist, inventory, verify } from './frontend-dist.mjs';
const files = inventory(); // Validate sources before removing the previous stage.
fs.rmSync(dist, { recursive: true, force: true });
for (const [name, source] of files) {
  const target = path.join(dist, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, source), target);
  fs.chmodSync(target, 0o644);
  fs.utimesSync(target, 0, 0);
}
const records = verify();
console.log(`frontend staging: OK (${records.length} runtime files, ${records.reduce((n, r) => n + r.bytes, 0)} bytes)`);
