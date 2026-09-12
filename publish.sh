#!/usr/bin/env bash
#
# Assemble the publish directory (_site/) that gets deployed to GitHub Pages.
#
# Only runtime files are copied: the source tree, node_modules and the build
# scripts stay in the repository. Run ./build.sh first (the CI does).
#
set -euo pipefail
cd "$(dirname "$0")"

[ -f index.html ] || { printf 'publish.sh: index.html missing — run ./build.sh first\n' >&2; exit 1; }

rm -rf _site
mkdir -p _site
cp -R index.html assets vendor paper.pdf sitemap.xml robots.txt .nojekyll _site/

# Publish the verification report so the 1:1 claim is inspectable at runtime.
[ -f verify-report.json ] && cp verify-report.json _site/

printf 'assembled _site (%s)\n' "$(du -sh _site | cut -f1)"
