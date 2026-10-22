#!/bin/sh
# Studio 64 for macOS: double-click this file. (The first time macOS may say it is from an
# unidentified developer: right-click it, choose Open, then Open again. See "GETTING STARTED.txt".)
cd "$(dirname "$0")" || exit 1
exec sh tools/launch.sh "$@"
