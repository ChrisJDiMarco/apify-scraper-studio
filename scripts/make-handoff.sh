#!/usr/bin/env bash
# Builds a secret-free source zip of Golden Thread from a committed git revision, for handing the code to another team.
#
#   scripts/make-handoff.sh [--ref <rev>] [--allow-dirty] <output.zip>
#     --ref          the commit, tag or branch to archive (default HEAD)
#     --allow-dirty  build even though the working folder has uncommitted changes (they are NOT included)
#
# Why git archive: zipping the working folder would ship git-ignored files such as .env.local (a developer's OpenAI
# key), .claude/launch.json (preview passwords), node_modules, dist/ DMGs and coverage, about 3 GB in all. Only
# committed files can get in here, and out/, dist/, coverage/, node_modules/, .claude/ and .env files are excluded on
# top. The finished zip is then checked: it fails on secret file names (.env other than .env.example, private keys,
# data backups and nested archives, whose insides the text scan can't read) and on key-shaped strings, and warns about
# absolute home-folder paths (macOS, Linux and Windows) outside test/. It prints the size and SHA-256
# and writes <output.zip>.sha256 next to it. On Windows, run it from Git Bash (Git for Windows ships unzip and cygpath).
set -euo pipefail

usage() { echo "Usage: scripts/make-handoff.sh [--ref <rev>] [--allow-dirty] <output.zip>" >&2; exit 2; }
ref=HEAD; allow_dirty=0; out=''
while [ $# -gt 0 ]; do
  case "$1" in
    --ref) [ $# -ge 2 ] || usage; ref="$2"; shift 2 ;;
    --allow-dirty) allow_dirty=1; shift ;;
    -h|--help) usage ;;
    -*) echo "Unknown option: $1" >&2; usage ;;
    *) [ -z "$out" ] || usage; out="$1"; shift ;;
  esac
done
[ -n "$out" ] || usage
case "$out" in *.zip) ;; *) echo "The output path must end in .zip: $out" >&2; exit 2 ;; esac
# Git Bash on Windows: C:\x\out.zip or C:/x/out.zip becomes /c/x/out.zip, so the absolute-path check below sees it.
if command -v cygpath >/dev/null 2>&1; then out=$(cygpath -u "$out"); fi
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac  # relative to where the script was run, before the cd below
command -v git >/dev/null || { echo "git is required." >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required to check the archive." >&2; exit 1; }

repo=$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)
cd "$repo"
commit=$(git rev-parse --verify --quiet "${ref}^{commit}") || { echo "Not a commit: $ref" >&2; exit 1; }
if [ -n "$(git status --porcelain)" ]; then
  if [ "$allow_dirty" = 1 ]; then
    echo "Warning: the working folder has uncommitted changes; they are NOT in the archive (it is built from $ref)." >&2
  else
    echo "The working folder has uncommitted changes. Commit them first (the archive is built from $ref and would leave them out), or pass --allow-dirty." >&2
    exit 1
  fi
fi
version=$(git show "$commit:package.json" | sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -n 1)
[ -n "$version" ] || version=unknown
short=$(git rev-parse --short "$commit")
prefix="scraper-studio-${version}-${short}/"
mkdir -p "$(dirname "$out")"
rm -f "$out" "$out.sha256"

# A manifest inside the zip says exactly which commit it is (git 2.40+; older git just skips it).
manifest_args=()
help_text=$(git archive -h 2>&1 || true)
case "$help_text" in
  *add-virtual-file*)
    manifest="Golden Thread source handoff
version: ${version}
commit: ${commit}
ref: ${ref}
commit date: $(git show -s --format=%cI "$commit")
archived: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Built with scripts/make-handoff.sh from committed files only. Start with HANDOFF.md.
"
    manifest_args=("--add-virtual-file=${prefix}HANDOFF-MANIFEST.txt:${manifest}") ;;
esac

git archive --format=zip --prefix="$prefix" -o "$out" ${manifest_args[@]+"${manifest_args[@]}"} "$commit" -- . \
  ':(exclude,glob)**/.env' ':(exclude,glob)**/.env.local' ':(exclude,glob)**/.env.*.local' \
  ':(exclude,glob)**/node_modules/**' ':(exclude,glob)out/**' ':(exclude,glob)dist/**' ':(exclude,glob)coverage/**' \
  ':(exclude,glob).claude/**' ':(exclude,glob)studio-backups/**'

work=$(mktemp -d "${TMPDIR:-/tmp}/scraper-studio-handoff.XXXXXX")
cleanup() { rm -rf "$work"; }
trap cleanup EXIT
unzip -q "$out" -d "$work"

fail=0
names=$(cd "$work" && find . -type f | sed 's#^\./##' \
  | grep -E '(^|/)\.env($|\.)|(^|/)\.claude/launch\.json$|\.(pem|p12|p8|key|keychain|mobileprovision)$|(^|/)id_(rsa|ecdsa|ed25519)$|\.(tar\.gz|tgz|zip|bundle)$|(^|/)scraper-studio-backup-' \
  | grep -vE '(^|/)\.env\.example$' || true)
if [ -n "$names" ]; then echo "Secret-looking files in the archive:" >&2; echo "$names" >&2; fail=1; fi

# Real keys are long; the test fixtures use short fake ones (sk-ant-api03-test-key-…, apify_api_SETUPTEST…).
secrets=$(grep -rIlE \
  -e 'sk-ant-(api|admin)[0-9]{2}-[A-Za-z0-9_-]{60,}' \
  -e 'sk-(proj|svcacct|admin)-[A-Za-z0-9_-]{40,}' \
  -e 'sk-[A-Za-z0-9]{48}' \
  -e 'apify_api_[A-Za-z0-9]{30,}' \
  -e 'AKIA[0-9A-Z]{16}' \
  -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' \
  -e 'xox[abprs]-[A-Za-z0-9-]{20,}' \
  -e 'gh[pousr]_[A-Za-z0-9]{36}' \
  -e 'AIza[0-9A-Za-z_-]{35}' \
  -e 'ya29\.[0-9A-Za-z_-]{30,}' \
  -e 'STUDIO_(SECRET_KEY|PASSWORD|PROXY_SECRET)=[A-Za-z0-9+/_-]{16,}' \
  "$work" || true)
if [ -n "$secrets" ]; then echo "Key-shaped strings found in:" >&2; echo "$secrets" | sed "s#^$work/##" >&2; fail=1; fi

homes=$(grep -rIlE -e '/(Users|home)/[a-z][a-z0-9._-]+/' -e '[A-Za-z]:[\\/](Users|Documents and Settings)[\\/][A-Za-z0-9._ -]+[\\/]' "$work" \
  | sed "s#^$work/##" | grep -vE "^${prefix}test/" || true)
if [ -n "$homes" ]; then echo "Warning: absolute home-folder paths (review before sending):" >&2; echo "$homes" | sed 's/^/  /' >&2; fi

if [ "$fail" = 1 ]; then rm -f "$out"; echo "Nothing was written: fix the files above, commit, and run this again." >&2; exit 1; fi

if command -v shasum >/dev/null; then hash=$(shasum -a 256 "$out" | cut -d' ' -f1); else hash=$(sha256sum "$out" | cut -d' ' -f1); fi
printf '%s  %s\n' "$hash" "$(basename "$out")" > "$out.sha256"
bytes=$(wc -c < "$out" | tr -d ' ')
files=$(cd "$work" && find . -type f | wc -l | tr -d ' ')
echo "Wrote $out"
echo "  from:   $ref ($commit), version $version"
echo "  files:  $files"
echo "  size:   $(du -h "$out" | cut -f1) ($bytes bytes)"
echo "  sha256: $hash (also in $(basename "$out").sha256)"
