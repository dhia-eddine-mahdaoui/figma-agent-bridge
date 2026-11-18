#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VERSION=24.19.0
case "$(uname -s)" in Darwin) PLATFORM=darwin ;; Linux) PLATFORM=linux ;; *) echo 'Use bootstrap.ps1 on Windows' >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) echo 'Supported architectures: x64 and arm64' >&2; exit 1 ;; esac
ARCHIVE="node-v$VERSION-$PLATFORM-$ARCH.tar.gz"
# Matches node-checksums.json; updating Node requires reviewing both pinned inventories.
case "$PLATFORM-$ARCH" in
  darwin-x64) HASH=d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316 ;;
  darwin-arm64) HASH=8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d ;;
  linux-x64) HASH=f625d97cd707df4ff96254916fbc5ff014f09c09effe5a1e0ca8f6d41a8789d4 ;;
  linux-arm64) HASH=d28c8a5bf0a808f0ed434a1dce8c54ae98f0371c0bd86ac58abc613f73e6643f ;;
esac
CACHE="$SCRIPT_DIR/.bootstrap"
mkdir -p "$CACHE"
TEMP=$(mktemp -d "$CACHE/extract.XXXXXX")
trap 'rm -rf "$TEMP"' EXIT HUP INT TERM
if [ ! -f "$CACHE/$ARCHIVE" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$VERSION/$ARCHIVE" -o "$TEMP/$ARCHIVE"
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$TEMP/$ARCHIVE" | cut -d ' ' -f 1); else ACTUAL=$(shasum -a 256 "$TEMP/$ARCHIVE" | cut -d ' ' -f 1); fi
  [ "$ACTUAL" = "$HASH" ] || { echo 'Node checksum mismatch; refusing to execute it' >&2; exit 1; }
  mv "$TEMP/$ARCHIVE" "$CACHE/$ARCHIVE"
fi
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$CACHE/$ARCHIVE" | cut -d ' ' -f 1); else ACTUAL=$(shasum -a 256 "$CACHE/$ARCHIVE" | cut -d ' ' -f 1); fi
[ "$ACTUAL" = "$HASH" ] || { echo 'Cached Node archive checksum mismatch' >&2; exit 1; }
tar -xzf "$CACHE/$ARCHIVE" -C "$TEMP" "node-v$VERSION-$PLATFORM-$ARCH/bin/node" "node-v$VERSION-$PLATFORM-$ARCH/LICENSE"
exec_path="$TEMP/node-v$VERSION-$PLATFORM-$ARCH/bin/node"
"$exec_path" "$SCRIPT_DIR/install-agent.mjs" --node-license "$TEMP/node-v$VERSION-$PLATFORM-$ARCH/LICENSE" "$@"
