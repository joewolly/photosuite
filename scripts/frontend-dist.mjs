// Shared production asset inventory. Vendor trees are never walked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'espree';
import { createHash } from 'node:crypto';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/frontend-runtime-assets.json')));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
// Git's Windows checkout settings must not change the embedded frontend.
// Only reviewed text formats are normalized; model/font/image/WASM bytes are exact.
export function sourceBytes(source) {
  return normalizeSourceBytes(source, fs.readFileSync(path.join(root, source)));
}
export function normalizeSourceBytes(source, bytes) {
  const text = /\.(js|mjs|html|css|json|svg|cube|txt|md)$/i.test(source) || /(^|\/)(LICENSE[^/]*|COPYING[^/]*)$/.test(source);
  return text ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes;
}
export function allowedPath(name) {
  if (name.includes('\\') || name.startsWith('/') || name.split('/').some(p => !p || p.startsWith('.'))) return false;
  return !/(^|\/)(tests?|__tests__|fixtures?|examples?|scripts|build|target|node_modules|evidence|audit|corpus|logs?|ci)(\/|$)|\.(test|spec)\.|\.(map|sh|rs|c|cpp|h|toml|lock|log|ckpt|pth|pt|safetensors|pem|key)$|(^|\/)(package\.json|Makefile|Dockerfile|build\.[^/]+)$/i.test(name);
}
function regularFile(file) {
  let current = root;
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Outside repository: ${file}`);
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink rejected: ${current}`);
  }
  if (!fs.statSync(file).isFile()) throw new Error(`Not a regular file: ${file}`);
}
export function inventory() {
  const files = new Map();
  const add = (name, source) => {
    if (!allowedPath(name)) throw new Error(`Prohibited runtime path: ${name}`);
    if (files.has(name)) {
      if (source && files.get(name) !== source) throw new Error(`Conflicting runtime path: ${name}`);
      return;
    }
    source ||= `src/${name}`;
    regularFile(path.join(root, source));
    files.set(name, source);
  };
  for (const [name, source] of Object.entries(manifest.files)) add(name, source);
  add('index.html');
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  // Scripts, styles, icons, and literal BINDB entries are authoritative roots.
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"|"[^"\n]+"\s*:\s*"(\/[^"\n]+)"/g)) add((match[1] || match[2]).replace(/^\//, ''));
  for (const name of manifest.moduleRoots) add(name);
  const visited = new Set();
  const scan = name => {
    if (visited.has(name) || name.startsWith('vendor/') || !name.endsWith('.js')) return;
    visited.add(name);
    const ast = parse(fs.readFileSync(path.join(root, files.get(name)), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
    const dependency = spec => {
      if (typeof spec !== 'string' || !spec.startsWith('.')) return;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), spec));
      if (target.endsWith('/')) return;
      add(target); scan(target);
    };
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) dependency(node.source?.value);
      if (node.type === 'CallExpression' && node.callee?.name === 'importScripts') node.arguments.forEach(a => dependency(a.value));
      if (node.type === 'NewExpression' && node.callee?.name === 'URL' && node.arguments[1]?.type === 'MemberExpression') dependency(node.arguments[0]?.value);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(ast);
  };
  for (const name of files.keys()) scan(name);
  return new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
export function verify(directory = dist) {
  const expected = inventory();
  const actual = [];
  const walk = (dir, prefix = '') => {
    if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Symlink rejected: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (!allowedPath(name)) throw new Error(`Prohibited staged path: ${name}`);
      if (entry.isSymbolicLink()) throw new Error(`Symlink rejected: ${name}`);
      if (entry.isDirectory()) {
        if (![...expected.keys()].some(p => p.startsWith(name + '/'))) throw new Error(`Unexpected directory: ${name}`);
        walk(path.join(dir, entry.name), name + '/');
      } else if (entry.isFile()) actual.push(name);
      else throw new Error(`Non-file rejected: ${name}`);
    }
  };
  walk(directory);
  for (const name of actual) if (!expected.has(name)) throw new Error(`Unexpected staged file: ${name}`);
  const records = [];
  for (const [name, source] of expected) {
    const bytes = fs.readFileSync(path.join(directory, name));
    const hash = sha256(bytes);
    if (hash !== sha256(sourceBytes(source))) throw new Error(`Changed staged bytes: ${name}`);
    records.push({ path: name, bytes: bytes.length, sha256: hash });
  }
  return records;
}
