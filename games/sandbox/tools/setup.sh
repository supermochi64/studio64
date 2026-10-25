#!/usr/bin/env bash
# Sets up everything the sandbox needs to build, in ~/n64 (no root needed):
#   - libdragon's GCC toolchain for the N64 (a .deb from libdragon's releases, unpacked, checksum checked)
#   - libdragon (preview branch) and Tiny3D at the commits this game was made with, built and installed
# Afterwards:  export N64_INST=~/n64/inst  and run  make  in games/sandbox.
set -euo pipefail

ROOT="${N64_ROOT:-$HOME/n64}"
INST="$ROOT/inst"
LIBDRAGON_COMMIT=39d0d6096130836a65710da6730290701d060272   # libdragon, preview branch
TINY3D_COMMIT=f2eccc3998967f1915be58d52f1c5bb6d5598a8c      # Tiny3D (HailToDodongo)
TOOLCHAIN_URL=https://github.com/DragonMinded/libdragon/releases/download/toolchain-continuous-prerelease
case "$(uname -m)" in
  x86_64) DEB=gcc-toolchain-mips64-x86_64.deb; SHA=fac8e6572493a66468b7d45df41b042f90b1a630ec96aa218bd5fb1f320a0a4d ;;
  aarch64) DEB=gcc-toolchain-mips64-aarch64.deb; SHA=271a6f10c891b316a4e47959698cc7d9a8da1261ca3aa13edea0c82de22bc4b4 ;;
  *) echo "no prebuilt N64 toolchain for $(uname -m): build one with libdragon's tools/build-toolchain.sh"; exit 1 ;;
esac

mkdir -p "$ROOT" "$INST"
cd "$ROOT"

# 1. the compiler
if [ ! -x "$INST/bin/mips64-elf-gcc" ]; then
  echo "== the N64 toolchain"
  curl -fL -o "$DEB" "$TOOLCHAIN_URL/$DEB"
  if ! echo "$SHA  $DEB" | sha256sum -c -; then
    echo "note: the continuous toolchain release changed since this script was written; check it before use"
  fi
  rm -rf toolchain && mkdir toolchain && dpkg-deb -x "$DEB" toolchain
  cp -a toolchain/opt/libdragon/. "$INST/"
fi
export N64_INST="$INST" PATH="$INST/bin:$PATH"

# 2. libdragon
if [ ! -d libdragon ]; then git clone https://github.com/DragonMinded/libdragon.git; fi
(cd libdragon && git fetch -q origin && git checkout -q "$LIBDRAGON_COMMIT" && make -j"$(nproc)" install tools-install)

# 3. Tiny3D (the 3D library and its glTF converter)
if [ ! -d tiny3d ]; then git clone https://github.com/HailToDodongo/tiny3d.git; fi
(cd tiny3d && git fetch -q origin && git checkout -q "$TINY3D_COMMIT" && ./build.sh)

echo
echo "Done. Now:  export N64_INST=$INST  and run  make  in games/sandbox"
