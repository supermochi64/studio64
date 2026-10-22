# Building the engine

The game runs in the browser as WebAssembly, built from `engine/` (sm64ex with Studio 64's
changes) and your own ROM. **You normally never do this by hand:** on a fresh checkout,
`npm start` opens the first-run setup in the browser, which installs the compiler, builds the
engine and makes all generated data (see [Getting started](getting-started.md#the-setup-page)).
This page is for building by hand, and for what happens underneath.

You build it once after checking out the repository, and again only after changing C code in
`engine/` or the object catalog.

- [Requirements](#requirements)
- [Build](#build)
- [The first-run setup](#the-first-run-setup)
- [What the build does](#what-the-build-does)
- [Generated data](#generated-data)
- [Super Mario Sunshine characters](#super-mario-sunshine-characters)
- [The Shoggoth content](#the-shoggoth-content)
- [Platforms](#platforms)
- [Problems](#problems)

## Requirements

| | |
|---|---|
| **ROM** | Super Mario 64, US version, at `engine/baserom.us.z64` in `.z64` (big-endian) byte order. Its SHA-1 must be `9bef1128717f958171a4afac3ed78ee2bb4e86ce` (the build checks it). The setup page converts `.n64`/`.v64` and unzips for you. |
| **Emscripten SDK** | Emscripten 6.0.12. Found in `$EMSDK`, `~/.local/src/emsdk`, or the copy the setup installs in the Studio 64 cache (`~/.cache/studio64/emsdk`, macOS `~/Library/Caches/studio64/emsdk`). |
| **Host tools** | Python 3.8+ (standard library only), GNU `make` (3.81 or newer), `cc` and `c++` (the decomp's asset tools are built for your machine first), `tar`. **When any of them is missing they are downloaded into `.runtime/`** (`tools/lib/toolchain.mjs`, pinned versions with SHA-256 checksums): Python 3.12 from [python-build-standalone](https://github.com/astral-sh/python-build-standalone), [Zig](https://ziglang.org) 0.16 as the C/C++ compiler (`.runtime/bin/cc`, `c++`, `ar`, `ld` wrap `zig cc` etc.), GNU make 4.4.1 built from its source, and on Windows [w64devkit](https://github.com/skeeto/w64devkit) 2.10 (gcc, make, BusyBox sh). Where GNU `cpp`, `as`, `objcopy` or `xz` are missing, small wrappers use the Emscripten SDK's clang and llvm-objcopy, or Python's lzma (their output was checked to be the same). |
| **Node.js** | 18 or newer, for the server and the tools |

Installing the Emscripten SDK by hand (the setup downloads the same release as a tarball, no git
needed):

```sh
git clone --branch 6.0.12 --depth 1 https://github.com/emscripten-core/emsdk.git ~/.local/src/emsdk
cd ~/.local/src/emsdk
./emsdk install 6.0.12
./emsdk activate 6.0.12
```

## Build

```sh
npm run build:engine
```

This runs `tools/build_engine.mjs` (`tools/build_engine.sh` is a wrapper for it), which:

1. takes a lock (`engine/.build.lock.d` with the builder's pid; a lock left by a killed build is
   taken over), so two builds in the same tree never run at once,
2. makes sure Python, a C/C++ compiler and make are there (`tools/lib/toolchain.mjs`: the system's
   when they work, else the private copies in `.runtime/`, downloaded if needed),
3. sets up the Emscripten environment (what `emsdk_env.sh` would set) from `$EMSDK`,
   `~/.local/src/emsdk` or the setup's cache,
4. puts the stand-in for the Sunshine characters into `engine/src/studio/sms/gen/` if no disc was
   converted (see below),
5. makes the Shoggoth pieces that are built on the game's own Toad and Goomba from your ROM
   (`tools/shoggoth/rom_parts.py`, see [below](#the-shoggoth-content); the first time it runs
   sm64ex's `extract_assets.py` for the textures it needs),
6. regenerates the object catalog (`tools/gen_catalog.py`),
7. runs `make TARGET_WEB=1 VERSION=us -j<jobs>` in `engine/` (the first time, sm64ex's
   `extract_assets.py` extracts the game's assets from your ROM; `STUDIO_JOBS` sets the number
   of parallel jobs, by default the CPU cores but at most one per 0.6 GB of memory),
8. copies `sm64.us.f3dex2e.js` and `sm64.us.f3dex2e.wasm` from `engine/build/us_web/` to
   `web/engine/` (copy, then rename, so a page that is loading the game never sees half a file).

The build works from a folder whose path has spaces or accents (the release ZIP unpacks to
"Studio 64"): `make` runs by name from `PATH` and every Makefile path is relative.

The first build takes a few minutes; later builds only recompile what changed. Reload the
studio afterwards.

## The first-run setup

`npm start` runs `tools/start.mjs`: it installs missing npm packages, starts the server and
restarts it when the setup asks (exit code 75, to load the new catalog). While
`web/engine/sm64.us.f3dex2e.wasm` is missing (or a setup is running or stopped half way), the
server answers `/` with `web/setup.html`. A checkout that already has `web/engine/` (prebuilt)
skips it.

The setup itself is `server/setup/` (`pipeline.js` has the steps, `rom.js` checks the ROM,
`env.js` finds Python, the SDK and the compilers) with its API in `server/routes/setup.js`. Its
state, log and uploads live in `.setup/` (`.setup/setup.log` is the full log). Every step skips
what is done already, so "Continue" and "Try again" simply run it again. The picture and sample
steps start a second server on a free port (`STUDIO_SETUP=off`, a temporary projects folder)
and drive it with Chrome, Chromium or Edge (`tools/lib/browser.mjs` finds one; `CHROME` overrides;
without any, Playwright's Chromium is downloaded).

## What the build does

- `TARGET_WEB=1` selects sm64ex's web target. Studio 64's Makefile changes add
  `src/studio` and `src/studio/sms` to the sources, turn on `NODRAWINGDISTANCE` (objects stay
  active at any distance, and the object pool grows to 960), and set the Emscripten flags: SDL2
  and WebGL 2 from Emscripten, 256 MB initial memory with growth, the exported runtime functions
  the page uses, and `engine/src/studio/shell.html` as the page template.
- `tools/gen_catalog.py` reads the decomp's level scripts, macro objects and special objects and
  writes `engine/src/studio/gen/catalog.inc.c` (the table the engine links) and
  `server/data/catalog.json` (what the server and the app search). See
  [Adding catalog objects](adding-objects.md).

## Generated data

Some files in `web/data/` and `web/thumbs/` are made from the game by scripts. You only need to
run these when you change what they read:

| Script | Writes | Run it when |
|---|---|---|
| `python3 tools/gen_catalog.py` | `engine/src/studio/gen/catalog.inc.c`, `server/data/catalog.json` | automatically by `build:engine` |
| `python3 tools/gen_textures.py` | `web/data/textures.json` (texture fingerprints for the texture browser) | after building the engine from a different ROM |
| `python3 tools/gen_story_data.py` | `web/data/story_texts.json`, `web/data/story_font.png` | the game's texts or font changed |
| `python3 tools/gen_sounds.py` | `web/data/sounds.json` | the sound list changed |
| `python3 tools/analyze_instruments.py` (with `tools/seq_usage.py`) | `web/data/instruments.json` | the sound banks changed |
| `node tools/gen_debug_names.mjs` | `web/data/debug_names.json` | Mario's actions or surface types changed |
| `node tools/make_thumbs.mjs [ids...]` | `web/thumbs/<id>.webp` (object library pictures) | you added catalog objects |
| `node tools/make_level_thumbs.mjs` | `web/thumbs/levels/` | launcher pictures of the original levels |
| `node tools/make_template_thumbs.mjs` | `web/thumbs/templates/` | you changed `web/js/templates.js` |
| `node tools/make_hub_thumbs.mjs` | `web/thumbs/hub/` | home screen start cards |
| `npm run samples` (`tools/make_all_samples.mjs`: `make_samples.mjs`, `make_castle_sample.mjs`, `make_showcase_sample.mjs` on a server of its own) | `server/samples/*.s64hack` | the sample hacks (they come from the game's data, so a fresh clone has none until you run it; the home screen just leaves them out) |
| `node tools/ui_shots.mjs` | `docs/img/*.png` | the documentation screenshots |

The first-run setup runs all of these (except `ui_shots.mjs`). The thumbnail scripts,
`make_castle_sample.mjs` and `ui_shots.mjs` drive a real browser with Playwright: the server must
be running (`STUDIO_URL` points them to it, default `http://127.0.0.1:8064`), and they use Chrome,
Chromium, Edge or Brave wherever it is installed (`tools/lib/browser.mjs`; `CHROME=/path` to
choose).

## Super Mario Sunshine characters

Optional. Without them, `engine/src/studio/sms/gen/` holds a stand-in (copied from
`engine/src/studio/sms/stub/` by the build): the behaviors compile, there are no bodies, and
`gen_catalog.py` leaves the `sms:*` objects out, so the **Sunshine** library category shows an
"Add your Sunshine disc" card instead.

To add them, use the setup page (`/setup.html?add=sunshine`), or by hand:

```sh
pip install -r tools/requirements.txt                       # numpy + Pillow (the setup uses a venv in .setup/python)
SMS_ISO=path/to/sunshine.iso python3 tools/sms/convert.py   # writes engine/src/studio/sms/gen/
npm run build:engine
```

See [Sunshine characters](sunshine.md).

## The Shoggoth content

Tokyo (the level template), Shotgun Mario and the gangsters, the cars and the Drift King's races,
and Katana Mario with the katana fighters come from the hack *Shoggoth World* and **ship
with Studio 64**: every checkout has them, no Shoggoth World needed.

| Where | What |
|---|---|
| `engine/src/studio/shoggoth/gen/`, `web/data/shoggoth/` | Tokyo: its level data, models, textures, yokai code; the template (objects, texts, song), its sky and card |
| `engine/src/studio/shotgun/` | the shotgun, its effect textures, the gangsters and their bullets |
| `engine/src/studio/vehicles/` | the ten cars and the Drift King |
| `engine/src/studio/katana/`, `web/data/katana.json` | the Legendary Blade, the six cosplayer fighters, their animations, the crescents and manga words, the arm poses; the fight's lines and speeches and its battle theme |
| `engine/sound/sound_banks/26_studio_tokyo.json`, `engine/sound/samples/instruments/custom_sh_*.aiff` | the instruments of Tokyo's song and the battle theme (the game's samples, named; the hack's own synthesised ones, shipped) |

**The repository holds none of the game's data.** A few Shoggoth characters are *dressed* game characters: the Toads in
Tokyo's crowd, the yakuza, the stationmaster, the Drift King and the katana cosplayers are the
game's Toad with his own triangles re-lit in new colours, gear hung on his bones and his cap
recoloured; the gangsters and Tokyo's oni are the game's Goomba with re-lit feet and repainted
faces. For those pieces the repository holds only **recipes** (`rom_recipes.json` next to each
package): the display lists' own commands with "triangle 12 of `toad_seg6_dl_06007EB0`, UVs zeroed"
instead of the triangles, and for each texture the colour models of the recolour, which game
texture it starts from and the texels the user painted. Every engine build turns them into C again
from your ROM's Toad and Goomba (`tools/shoggoth/rom_parts.py` → `engine/src/studio/romgen/`,
gitignored; the shipped C includes those files where the game's data was). The rebuilt pieces are
identical to the hack's.

**Refreshing it from a Shoggoth World checkout** (a developer tool; the hack must have been built
once, its PNG textures come from its `build/us`):

```sh
npm run shoggoth:refresh            # node tools/shoggoth/refresh.mjs [path/to/sm64-master], or SHOGGOTH_DIR
npm run build:engine
```

`refresh.mjs` only reads the checkout. It runs the four extractors
(`tools/import_shoggoth_tokyo.mjs`, `tools/shotgun_extract.py`, `tools/vehicles/extract_cars.py`,
`tools/katana_extract.py`), then `tools/shoggoth/split_vanilla.py` on their output (it takes the
game's data back out, writes the recipes and checks that each rebuilt piece is exact), then
`npm run shoggoth:check` (`tools/shoggoth/check_shipped.mjs`: fails if any vanilla triangle or
recoloured vanilla texture is left in the shipped files; the test `shoggoth_content` runs it too).
Commit what changed. Never run an extractor alone and commit its output.

## Platforms

| | |
|---|---|
| **Linux** | Fully automatic, also without any developer tools (no gcc, make, git, Python or xz needed): tested in clean Ubuntu 22.04/24.04, Debian 12, Fedora 44 and Arch images (`tests/setup/sandbox.mjs`). With the distribution's build tools installed it uses those. |
| **macOS** | Automatic, without Xcode or Apple's command line tools: Zig compiles the host tools (it brings the macOS C library stubs; the tools were cross-compiled for macOS with it), the SDK's clang preprocesses and assembles, Python and make come from `.runtime/`. Apple's install-me stubs (`/usr/bin/cc`, `make`, `git`, `python3` without the command line tools) are never run. Not yet tested on a Mac: `.github/workflows/setup.yml` runs it on `macos-14`. |
| **Windows** | Native, without WSL: w64devkit's gcc, make and BusyBox sh in `.runtime/w64devkit`, Python from `.runtime/python`, the SDK in `%LOCALAPPDATA%\studio64\emsdk`. Not yet tested on a Windows machine: `.github/workflows/setup.yml` runs it on `windows-2022`. `STUDIO_BUILD_HOST=wsl` builds in WSL instead (`server/setup/host.js`, the previous way). |
| **Docker** | `docker compose up` (`Dockerfile`: Node 22, build tools, Emscripten 6.0.12 with SDL2 prebuilt, Chromium). |

## Problems

| Message | Fix |
|---|---|
| `engine/baserom.us.z64 missing` | Run `npm start` and drop the ROM into the page, or copy your US ROM there, named exactly `baserom.us.z64`. |
| A SHA-1 mismatch from `extract_assets.py` | The ROM is not the US version, or not in `.z64` byte order. The setup page converts and explains. |
| `The Emscripten SDK was not found` | Run `npm start` (the setup installs it), or install it (above) and set `EMSDK=/path/to/emsdk`. |
| `Failed to build tools` | The host compiler did not work. Delete `.runtime/toolchain.json` and build again: the setup tests the system's compiler and uses Zig when it fails. `STUDIO_TOOLCHAIN=private` always uses the downloaded tools. |
| A download in `.runtime/` failed or was damaged | Delete the tool's folder in `.runtime/` (or all of `.runtime/`) and build again. |
| The studio still runs the old game | Reload with the cache cleared (`Ctrl+Shift+R`). |
| Errors about headers from `/usr/include` | Use the Emscripten SDK's compiler, not the system one: check that `emsdk_env.sh` was loaded. |

More in [Troubleshooting](troubleshooting.md).
