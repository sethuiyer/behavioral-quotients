// Small shared helpers.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SITE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO_ROOT = path.dirname(SITE_DIR);
// Prefer a colocated copy of the paper so the published repository is
// self-contained; fall back to the working tree one level up.
export const MD_PATH = existsSync(path.join(SITE_DIR, 'behavioral_quotients.md'))
  ? path.join(SITE_DIR, 'behavioral_quotients.md')
  : path.join(REPO_ROOT, 'behavioral_quotients.md');
export const INDEX_PATH = path.join(SITE_DIR, 'index.html');

/** Run pandoc and return stdout as a UTF-8 string. */
export function pandoc(args) {
  return execFileSync('pandoc', args, { maxBuffer: 256 * 1024 * 1024 }).toString('utf8');
}

/** Collapse whitespace runs. Used for every whitespace-insensitive comparison. */
export function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/** RFC-4180-ish slugify, matching Pandoc's auto_identifiers where possible. */
export function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/** Stable JSON serialisation (object keys sorted) so files are byte-identical. */
export function stableJson(value) {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}
