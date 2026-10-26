#!/bin/sh
# Fetch the Sparrow fixtures in spec/interop/sparrow/ again, at the pinned
# commit, and check every one against spec/interop/SHA256SUMS.
#
#   tools/fetch-interop-fixtures.sh <empty scratch directory>
#
# Needs network access, curl and sha256sum. It is a record of where the files
# came from that anyone can rerun, not part of any check: nothing in `make`
# runs it, and it writes only into the directory it is given. The file list is
# read from SHA256SUMS itself, so a fixture listed there that this cannot fetch
# fails here. The Bitcoin Core fixtures beside them are generated rather than
# fetched, by tools/gen-interop-core.sh.
set -eu

# sparrowwallet/sparrow master on 2026-10-26. See spec/interop/README.md.
SPARROW=d61b2a6ad3df1ec5a8c933cff5896c9445f78075
RAW="https://raw.githubusercontent.com/sparrowwallet/sparrow/$SPARROW"
RESOURCES=src/test/resources/com/sparrowwallet/sparrow/io

HERE=$(cd "$(dirname "$0")" && pwd)
SUMS="$HERE/../spec/interop/SHA256SUMS"
WORK=${1:?usage: fetch-interop-fixtures.sh <empty scratch directory>}

mkdir -p "$WORK"
WORK=$(cd "$WORK" && pwd)
if [ -n "$(ls -A "$WORK")" ]; then
  echo "fetch-interop-fixtures.sh: $WORK is not empty" >&2
  exit 1
fi

grep '  sparrow/' "$SUMS" > "$WORK/SHA256SUMS"
while read -r _ path; do
  name=${path#sparrow/}
  case "$name" in
    LICENSE) source="$RAW/LICENSE" ;;
    *) source="$RAW/$RESOURCES/$name" ;;
  esac
  mkdir -p "$WORK/$(dirname "$path")"
  curl -sSfL -o "$WORK/$path" "$source"
done < "$WORK/SHA256SUMS"

cd "$WORK"
sha256sum -c --quiet SHA256SUMS
echo "fetch-interop-fixtures: $(wc -l < SHA256SUMS | tr -d ' ') files from Sparrow $SPARROW match spec/interop/SHA256SUMS"
