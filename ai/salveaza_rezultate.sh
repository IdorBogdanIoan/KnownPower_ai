#!/usr/bin/env bash
# Salvează out/<rulare> pe ramura "rezultate" și actualizează latest.json.
# Folosire (din ai/): bash salveaza_rezultate.sh <rulare> <folder_rezultat>
set -euo pipefail
RULARE="$1"; SRC="$(cd "$2" && pwd)"
case "$RULARE" in *[!a-z0-9-]*|"") echo "nume de rulare invalid"; exit 1;; esac
git config --global user.name "github-actions[bot]"
git config --global user.email "41898282+github-actions[bot]@users.noreply.github.com"
URL="https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
DEST="$RUNNER_TEMP/rez"
rm -rf "$DEST"
if ! git clone -q --depth 1 --branch rezultate "$URL" "$DEST"; then
  mkdir -p "$DEST"; (cd "$DEST" && git init -q -b rezultate && git remote add origin "$URL")
fi
mkdir -p "$DEST/rulari"
rm -rf "$DEST/rulari/$RULARE"
cp -r "$SRC" "$DEST/rulari/$RULARE"
cd "$DEST"
python3 - "$RULARE" <<'PY'
import json, os, sys
r = sys.argv[1]
p = "latest.json"
lst = json.load(open(p)) if os.path.exists(p) else {"rulari": []}
idx = json.load(open(f"rulari/{r}/index.json"))
lst["rulari"] = [x for x in lst["rulari"] if x["rulare"] != r] + [{"rulare": r, "data": idx["data"], "total": idx["total"], "model": idx["model"], "model_case": idx["model_case"]}]
lst["ultima"] = r
json.dump(lst, open(p, "w"), ensure_ascii=False, indent=1)
PY
git add -A
git commit -q -m "Rulare $RULARE" || echo "nimic nou"
git push -q origin rezultate
echo "salvat pe ramura rezultate: rulari/$RULARE"
