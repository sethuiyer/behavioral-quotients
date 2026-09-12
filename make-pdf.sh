#!/usr/bin/env bash
# Optional PDF build (separate from the HTML pipeline; the site does not need it).
# Uses Tectonic, which fetches LaTeX packages on first run (cached afterwards).
set -euo pipefail
cd "$(dirname "$0")"
SRC=behavioral_quotients.md
[ -f "$SRC" ] || SRC=../behavioral_quotients.md
pandoc "$SRC" -o paper.pdf \
  --pdf-engine=tectonic \
  -V geometry:margin=1in \
  -V mainfont="DejaVu Serif" \
  -V monofont="DejaVu Sans Mono" \
  -V mathfont="DejaVu Math TeX Gyre"
echo "wrote paper.pdf ($(stat -c%s paper.pdf) bytes)"
