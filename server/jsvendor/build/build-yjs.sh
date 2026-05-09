#!/usr/bin/env bash
#
# Rebuilds sheets/server/jsvendor/yjs.bundle.js from yjs-entry.js + a
# crypto shim prelude.
#
# Run from this directory. Requires:
#   - bun (must resolve `yjs` from the linked app shell at
#     ../../../../tinycld/node_modules/)
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/../yjs.bundle.js"
shell_dir="$here/../../../../tinycld"

if [[ ! -d "$shell_dir/node_modules/yjs" ]]; then
    echo "no yjs in $shell_dir/node_modules/ — run 'bun install' in $shell_dir first" >&2
    exit 1
fi

tmp_entry="$shell_dir/_yjs-entry.tmp.js"
trap 'rm -f "$tmp_entry"' EXIT
cp "$here/yjs-entry.js" "$tmp_entry"

tmp_bundle="$(mktemp -t yjs-bundle.XXXXXX.js)"
trap 'rm -f "$tmp_entry" "$tmp_bundle"' EXIT

bun build --cwd="$shell_dir" "$tmp_entry" \
    --target=browser \
    --format=iife \
    --outfile="$tmp_bundle"

# Prepend the crypto shim so it runs before any IIFE inside the bundle
# touches `crypto`. yjs's `lib0/webcrypto.js` reads `crypto.subtle` and
# `crypto.getRandomValues` during module init.
#
# Quality: yjs only uses getRandomValues to seed Y.Doc clientIDs (one
# Uint32 per doc). Math.random over 2^32 is fine for in-room uniqueness;
# server-side docs don't outlive a session. SHA + signing happen
# elsewhere and aren't on this path.
prelude=$'if (typeof globalThis.crypto === "undefined") {\n  globalThis.crypto = {\n    getRandomValues: function (arr) {\n      for (var i = 0; i < arr.length; i++) {\n        arr[i] = Math.floor(Math.random() * 0x100000000);\n      }\n      return arr;\n    },\n    subtle: {},\n  };\n}\n'
{
    printf '%s' "$prelude"
    cat "$tmp_bundle"
} > "$out"

echo "wrote $out ($(wc -c < "$out") bytes)"
