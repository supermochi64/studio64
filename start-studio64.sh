#!/bin/sh
# Studio 64 for Linux: start it from here (double-click and choose "Run", or in a terminal:
# ./start-studio64.sh). The first start downloads what Studio 64 needs and opens the setup in your
# browser. See "GETTING STARTED.txt".
cd "$(dirname "$0")" || exit 1
exec sh tools/launch.sh "$@"
