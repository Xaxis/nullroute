#!/bin/sh
# Rebuild the website's self-hosted fonts from the foundries' own releases.
#
#   tools/gen-web-fonts.sh <empty scratch directory>
#
# Needs network access, curl, unzip, sha256sum (or shasum) and uv. It is a
# record of where every font file under apps/web/public/fonts came from, not
# part of any check: the files are committed, and nothing in `make` runs this.
# Run it on the same pins and the outputs are what SOURCES.md lists.
#
# WHY THESE CUTS. Source Serif 4's variable roman is 427 KB as released, and
# 189 KB even cut to Latin, because its optical-size axis carries many masters.
# The site needs three styles: text roman and italic for prose, and the
# display semibold for headings, which is the optical size the variable font
# would pick at that size anyway. As static cuts cut to Latin they total about
# 125 KB. IBM Plex ships its own Latin-1 split files, copied as released.
#
# The device draws hashes in DejaVu Sans Mono, and the site uses the same face
# for hashes so the glyphs a reader compares on the page are the glyphs the
# panel shows. It is cut to the characters a hash display needs.
#
# Licences: Source Serif 4 and IBM Plex are under the SIL Open Font License
# 1.1, copied beside the files. DejaVu is under the Bitstream Vera licence with
# DejaVu's changes in the public domain, also copied.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
OUT="$ROOT/apps/web/public/fonts"
WORK=${1:?usage: gen-web-fonts.sh <empty scratch directory>}
mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
if [ -n "$(ls -A "$WORK")" ]; then
  echo "gen-web-fonts.sh: $WORK is not empty" >&2
  exit 1
fi

GH=https://github.com
SERIF_URL="$GH/adobe-fonts/source-serif/releases/download/4.005R/source-serif-4.005_WOFF2.zip"
SERIF_SHA=af10e80dcd2296748b04cb9917db9f7ba0ae65101165fd2f0c16b9812d9abd28
SERIF_LICENSE="https://raw.githubusercontent.com/adobe-fonts/source-serif/4.005R/LICENSE.md"
SANS_URL="$GH/IBM/plex/releases/download/%40ibm%2Fplex-sans%401.1.0/ibm-plex-sans.zip"
SANS_SHA=fb365d910566e6d199cc2c15579a7dd9a267128e18431a394ed81f1970c69200
MONO_URL="$GH/IBM/plex/releases/download/%40ibm%2Fplex-mono%402.5.0/ibm-plex-mono.zip"
MONO_SHA=6d23f01257663d8cc49a0d64c22ced630b79e0e2a0ac08a0da86e9a38bbc481c
DEJAVU_URL="$GH/dejavu-fonts/dejavu-fonts/releases/download/version_2_37/dejavu-fonts-ttf-2.37.zip"
DEJAVU_SHA=7576310b219e04159d35ff61dd4a4ec4cdba4f35c00e002a136f00e96a908b0a
FONTTOOLS=4.66.1

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi; }
fetch() {
  curl -fsSL -o "$WORK/$2" "$1"
  echo "$3  $WORK/$2" | (cd / && if command -v sha256sum >/dev/null; then sha256sum -c -; else shasum -a 256 -c -; fi)
  (cd "$WORK" && mkdir -p "${2%.zip}" && cd "${2%.zip}" && unzip -q "../$2")
}

fetch "$SERIF_URL" serif.zip "$SERIF_SHA"
fetch "$SANS_URL" sans.zip "$SANS_SHA"
fetch "$MONO_URL" mono.zip "$MONO_SHA"
fetch "$DEJAVU_URL" dejavu.zip "$DEJAVU_SHA"
curl -fsSL -o "$WORK/serif-LICENSE.md" "$SERIF_LICENSE"

# Basic Latin, Latin-1, the general punctuation this site sets (curly quotes,
# dashes it does not use but a quoted source might, the ellipsis, the middle
# dot), arrows, the multiplication and minus signs, and the non-breaking space.
TEXT='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-203A,U+2190-2193,U+2212,U+2715,U+FEFF'
# A hash display: hex digits, the ellipsis that elides the middle, separators.
HEX='U+0020,U+002D,U+002E,U+0030-0039,U+003A,U+0041-0046,U+0061-0066,U+2026'

subset() {
  uvx --quiet --from "fonttools[woff]==$FONTTOOLS" pyftsubset "$1" \
    --unicodes="$2" --layout-features='*' --flavor=woff2 --output-file="$3"
}

mkdir -p "$OUT"
SERIF_DIR="$WORK/serif/source-serif-4.005_WOFF2/OTF"
subset "$SERIF_DIR/SourceSerif4-Regular.otf.woff2" "$TEXT" "$OUT/SourceSerif4-Regular.woff2"
subset "$SERIF_DIR/SourceSerif4-It.otf.woff2" "$TEXT" "$OUT/SourceSerif4-Italic.woff2"
subset "$SERIF_DIR/SourceSerif4Display-Semibold.otf.woff2" "$TEXT" "$OUT/SourceSerif4Display-Semibold.woff2"
cp "$WORK/sans/ibm-plex-sans/fonts/split/woff2/IBMPlexSans-Regular-Latin1.woff2" "$OUT/"
cp "$WORK/sans/ibm-plex-sans/fonts/split/woff2/IBMPlexSans-SemiBold-Latin1.woff2" "$OUT/"
cp "$WORK/mono/ibm-plex-mono/fonts/split/woff2/IBMPlexMono-Regular-Latin1.woff2" "$OUT/"
cp "$WORK/mono/ibm-plex-mono/fonts/split/woff2/IBMPlexMono-Medium-Latin1.woff2" "$OUT/"
subset "$WORK/dejavu/dejavu-fonts-ttf-2.37/ttf/DejaVuSansMono.ttf" "$HEX" "$OUT/DejaVuSansMono-Hex.woff2"

cp "$WORK/serif-LICENSE.md" "$OUT/LICENSE-SourceSerif4.txt"
cp "$WORK/sans/ibm-plex-sans/LICENSE.txt" "$OUT/LICENSE-IBMPlex.txt"
cp "$WORK/dejavu/dejavu-fonts-ttf-2.37/LICENSE" "$OUT/LICENSE-DejaVu.txt"

(cd "$OUT" && for f in *.woff2; do sha "$f"; done)
