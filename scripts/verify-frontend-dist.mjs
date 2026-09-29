#!/usr/bin/env node
import { verify } from './frontend-dist.mjs';
const records = verify(process.argv[2]);
console.log(`frontend verification: OK (${records.length} exact runtime files; no extra files or symlinks)`);
