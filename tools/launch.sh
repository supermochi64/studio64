#!/bin/sh
# Studio 64 launcher for Linux and macOS (start-studio64.sh and "Start Studio 64.command" run this).
# Finds Node.js 18+ on this computer or downloads a private copy into .runtime/node (no
# administrator rights, checked against its SHA-256 checksum), then starts tools/start.mjs, which
# opens Studio 64 in the browser. Everything Studio 64 downloads stays in this folder (and the
# compiler in your user cache): see docs/getting-started.md, "Uninstall".
#   STUDIO_NODE=system   only use the Node.js on PATH        STUDIO_NODE=private   always the private one
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$ROOT" || exit 1

NODE_VERSION=24.21.0
RUNTIME="$ROOT/.runtime"
NODE_DIR="$RUNTIME/node"

say() { printf '  %s\n' "$*"; }
line() { printf '  ------------------------------------------------------------\n'; }
stop() {
  printf '\n'
  say "$1"
  [ -n "${2:-}" ] && say "$2"
  printf '\n'
  # double-clicked: keep the window open so the message can be read
  if [ -t 0 ]; then printf '  Press Enter to close this window. '; read -r _ || true; fi
  exit 1
}

printf '\n'
line
say 'Studio 64'
line
say 'Make your own Super Mario 64, right in the browser.'
say 'Keep this window open while you use Studio 64. Close it to stop Studio 64.'
printf '\n'

OS=$(uname -s)
ARCH=$(uname -m)
case "$OS" in
  Linux) PLAT=linux ;;
  Darwin) PLAT=darwin ;;
  *) stop "This computer ($OS) is not supported by this launcher." "Install Node.js 18 or newer from https://nodejs.org and run: node tools/start.mjs" ;;
esac
case "$ARCH" in
  x86_64 | amd64) CPU=x64 ;;
  aarch64 | arm64) CPU=arm64 ;;
  *) stop "This processor ($ARCH) is not supported by the launcher." "Install Node.js 18 or newer from https://nodejs.org and run: node tools/start.mjs" ;;
esac
# an Intel build of Terminal on an Apple Silicon Mac (Rosetta): use the native Node all the same
if [ "$PLAT" = darwin ] && [ "$CPU" = x64 ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then CPU=arm64; fi

# the pinned downloads (nodejs.org/dist/v24.21.0/SHASUMS256.txt)
case "$PLAT-$CPU" in
  linux-x64) SUM=6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff ;;
  linux-arm64) SUM=724282c3b43aec998aa9527380465b45d229e021b58035f5f4f63095eabfe5d5 ;;
  darwin-x64) SUM=1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097 ;;
  darwin-arm64) SUM=bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057 ;;
esac
NAME="node-v$NODE_VERSION-$PLAT-$CPU"
URL="https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz"

node_ok() { # $1: a node binary; true when it is 18 or newer
  [ -x "$1" ] || command -v "$1" >/dev/null 2>&1 || return 1
  "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | sed 's/.*= *//'
  else echo none; fi
}

fetch() { # $1 url, $2 file
  if command -v curl >/dev/null 2>&1; then curl -fL --retry 3 --connect-timeout 20 --progress-bar -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q --show-progress -O "$2" "$1" || wget -O "$2" "$1"
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import sys, urllib.request; urllib.request.urlretrieve(sys.argv[1], sys.argv[2])' "$1" "$2"
  else return 9; fi
}

NODE=""
MODE=${STUDIO_NODE:-auto}
if [ "$MODE" != private ] && node_ok node; then NODE=$(command -v node); fi
if [ -z "$NODE" ] && [ "$MODE" != system ] && node_ok "$NODE_DIR/bin/node"; then NODE="$NODE_DIR/bin/node"; fi
if [ -z "$NODE" ]; then
  [ "$MODE" = system ] && stop 'Node.js 18 or newer was not found (STUDIO_NODE=system).' 'Install it from https://nodejs.org'
  say "Getting Node.js $NODE_VERSION, which runs Studio 64 (about 50 MB, only the first time)..."
  mkdir -p "$RUNTIME/downloads" || stop "Could not make the folder $RUNTIME." 'Is the Studio 64 folder writable? Move it to your home folder and try again.'
  TGZ="$RUNTIME/downloads/$NAME.tar.gz"
  if [ ! -f "$TGZ" ] || [ "$(sha256 "$TGZ")" != "$SUM" ]; then
    rm -f "$TGZ" "$TGZ.part"
    fetch "$URL" "$TGZ.part"
    rc=$?
    [ $rc = 9 ] && stop 'Neither curl nor wget is installed, so Node.js could not be downloaded.' 'Install curl (for example: sudo apt install curl), or install Node.js from https://nodejs.org'
    [ $rc = 0 ] || stop 'Downloading Node.js failed.' 'Check your internet connection, then start Studio 64 again.'
    mv "$TGZ.part" "$TGZ"
  fi
  GOT=$(sha256 "$TGZ")
  if [ "$GOT" != "$SUM" ]; then
    rm -f "$TGZ"
    if [ "$GOT" = none ]; then stop 'No tool to check the download was found (sha256sum or shasum).' 'Install Node.js 18 or newer from https://nodejs.org instead.'; fi
    stop 'The Node.js download was damaged (its checksum does not match).' 'Start Studio 64 again to download it once more.'
  fi
  rm -rf "$NODE_DIR" "$NODE_DIR.tmp"
  mkdir -p "$NODE_DIR.tmp"
  tar -xzf "$TGZ" -C "$NODE_DIR.tmp" --strip-components=1 || stop 'Unpacking Node.js failed.' 'Check that there is free disk space, then start Studio 64 again.'
  mv "$NODE_DIR.tmp" "$NODE_DIR"
  rm -f "$TGZ"
  node_ok "$NODE_DIR/bin/node" || stop 'The downloaded Node.js does not start on this computer.' 'Install Node.js 18 or newer from https://nodejs.org and start Studio 64 again.'
  NODE="$NODE_DIR/bin/node"
  say 'Node.js is ready.'
fi

# macOS: files from a downloaded ZIP are "quarantined"; the tools Studio 64 runs from this folder
# must not be (this only touches the Studio 64 folder)
if [ "$PLAT" = darwin ] && [ ! -f "$RUNTIME/unquarantined" ] && command -v xattr >/dev/null 2>&1; then
  xattr -dr com.apple.quarantine "$ROOT" 2>/dev/null || true
  mkdir -p "$RUNTIME" && echo 'Studio 64: the quarantine mark was taken off this folder once' > "$RUNTIME/unquarantined"
fi

# Linux: an entry in the applications menu, so next time Studio 64 starts from there
if [ "$PLAT" = linux ] && [ -z "${STUDIO_NO_MENU:-}" ] && [ -n "${XDG_CURRENT_DESKTOP:-}${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  ENTRY="$APPS/studio64.desktop"
  if [ ! -f "$ENTRY" ] || ! grep -qF "$ROOT/start-studio64.sh" "$ENTRY" 2>/dev/null; then
    mkdir -p "$APPS" 2>/dev/null && {
      printf '[Desktop Entry]\nType=Application\nName=Studio 64\nComment=Make your own Super Mario 64\nExec=sh "%s/start-studio64.sh"\nPath=%s\nIcon=%s/web/favicon.svg\nTerminal=true\nCategories=Game;Development;\n' "$ROOT" "$ROOT" "$ROOT" > "$ENTRY" &&
        say 'Studio 64 is now also in your applications menu.'
    }
  fi
fi

export STUDIO_LAUNCHER=1
"$NODE" "$ROOT/tools/start.mjs" "$@"
rc=$?
if [ $rc != 0 ] && [ $rc != 130 ] && [ $rc != 143 ]; then
  stop "Studio 64 stopped with an error (code $rc)." 'The messages above say what went wrong. Start Studio 64 again to retry.'
fi
exit $rc
