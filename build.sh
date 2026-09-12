#!/usr/bin/env bash
#
# Deterministic, offline build: ../behavioral_quotients.md -> index.html
#
# The build never touches the network: Pandoc and Node do the work, and MathJax
# is vendored under vendor/mathjax/. Node dependencies must already be present
# (one-time `npm ci`), which is why this script checks for them instead of
# installing them.
#
# Determinism is verified, not assumed: the build runs twice and the two
# index.html files must hash identically. Nothing in the output depends on the
# clock, the environment or the file system order.

set -euo pipefail
cd "$(dirname "$0")"

die() { printf 'build.sh: %s\n' "$1" >&2; exit 1; }

# --- preconditions ---------------------------------------------------------

command -v node   >/dev/null 2>&1 || die "node is not installed"
command -v pandoc >/dev/null 2>&1 || die "pandoc is not installed"

[ -f ../behavioral_quotients.md ]                 || die "../behavioral_quotients.md is missing (the single source of truth)"
[ -d node_modules ]                               || die "node_modules is missing; run 'npm ci' once, then re-run (the build itself stays offline)"
[ -f vendor/mathjax/tex-chtml-full.js ]           || die "vendored MathJax is missing at vendor/mathjax/tex-chtml-full.js"
[ -f assets/distill.css ]                         || die "assets/distill.css is missing"

hash_index() {
  node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync('index.html')).digest('hex'))"
}

# --- build -----------------------------------------------------------------

node build.mjs
first="$(hash_index)"

# --- prove reproducibility -------------------------------------------------

node build.mjs >/dev/null
second="$(hash_index)"

[ "$first" = "$second" ] || die "build is not deterministic: ${first} != ${second}"

printf 'deterministic: index.html sha256 %s\n' "$first"
