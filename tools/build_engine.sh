#!/bin/sh
# Builds the engine: the same as npm run build:engine (tools/build_engine.mjs does the work).
exec node "$(dirname "$0")/build_engine.mjs" "$@"
