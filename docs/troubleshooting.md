# Troubleshooting

Something does not work? Find the symptom below. If it is not here, please
[open an issue](../CONTRIBUTING.md#reporting-a-bug).

## Installing and building

The first-run setup page names every problem it finds and how to fix it; **Show details** has the
full log (also in `.setup/setup.log`), and **Copy the whole log** is handy for a bug report.

| Problem | What to do |
|---|---|
| Windows: "Windows protected your PC" | Click **More info** → **Run anyway** (once, for files from the internet). |
| macOS: "Start Studio 64.command cannot be opened" | Right-click it → **Open** → **Open**. On macOS 15: **System Settings → Privacy & Security → Open Anyway**. |
| Linux: `Permission denied` for `./start-studio64.sh` | Run `sh start-studio64.sh`, or make it executable: `chmod +x start-studio64.sh`. |
| "Downloading Node.js failed" | The launcher downloads Node.js once (from nodejs.org). Check your internet connection and start it again. A company proxy or filter may block it: install Node.js 18+ from [nodejs.org](https://nodejs.org) instead, the launchers use it. |
| "The Node.js download was damaged" | Start it again (it downloads once more). If it keeps happening, something on your network changes downloads. |
| `npm start` says Node.js is too old | Install Node.js 18 or newer from [nodejs.org](https://nodejs.org), or use the launchers (they bring their own). |
| `npm install failed` | Check your internet connection and start Studio 64 again. |
| "This is the Japanese version" / "European version" / "This ROM has been changed" | Studio 64 needs the original **US** ROM (SHA-1 `9bef1128…`). Byte order (`.z64`/`.n64`/`.v64`) and zip files don't matter. |
| "Unpack the archive first" | 7-Zip and RAR archives are not unpacked for you: unpack and drop the file inside. |
| "A download failed" (Python, Zig, make, w64devkit) | The setup downloads the build tools your computer lacks into `.runtime/`. Check the internet connection and press **Try again**. You can also install them yourself (Linux: `build-essential python3` or your distribution's equivalent; macOS: `xcode-select --install`): the setup then uses those. |
| "Building make failed" / "The downloaded Python does not start" | Delete the `.runtime` folder in the Studio 64 folder and press **Try again**. |
| Windows: "Could not unpack the build tools (w64devkit)" | Your antivirus may have stopped it. Allow `w64devkit…7z.exe` in `.runtime\downloads`, then **Try again**. |
| "Could not download the Emscripten SDK" / "Installing the compiler failed" | Check the internet connection and the free disk space (about 2 GB), then **Try again**. A broken half-installed copy: delete `~/.cache/studio64/emsdk` (macOS `~/Library/Caches/studio64/emsdk`). |
| "This is a compressed RVZ image" (or GCZ, WIA, CISO) | In Dolphin: right-click the game → *Convert File…* → *ISO*, then drop the `.iso`. |
| "Converting the Sunshine characters failed" | Studio 64 is made for the USA disc (`GMSE01`). Switch the Sunshine characters off to build without them; you can add them later. |
| "Some pictures could not be made" | The studio works without them. It needs Chrome, Chromium or Edge to render them; install one, then **Try again** (or `CHROME=/path/to/chrome npm start`). |
| The setup stopped half way (computer slept, `Ctrl+C`) | `npm start` again and press **Continue**. Finished steps are kept. |
| Windows: the build fails and you have WSL | Start Studio 64 with `STUDIO_BUILD_HOST=wsl` to build in WSL instead. Please also report the log. |
| `Port 8064 is already in use` | Without `PORT` set, Studio 64 takes the next free port and says which. With `PORT` set: pick another, `PORT=8070 npm start`. |
| The page loads but the game never starts | Reload with `Ctrl+Shift+R`. If it persists, rebuild: `npm run build:engine`. |
| Building by hand: `engine/baserom.us.z64 missing`, `The Emscripten SDK was not found` | See [Building the engine](building-the-engine.md#problems). |

## Playing

| Problem | What to do |
|---|---|
| Mario does not move | Click the game first: it needs the keyboard focus. `Esc` gives the focus back to the studio. |
| No sound | Browsers start audio only after you click or press a key on the page. Click the game once. |
| The game is slow | The game needs hardware-accelerated WebGL. Check that your browser's hardware acceleration is on (in Chrome: `chrome://gpu`). The play-test panel's FPS counter (`F3`) shows the game's frame rate. |
| A gamepad does nothing | Press a button on it while the page has focus; browsers only show a gamepad to a page after a button press. |
| "The game crashed" card | Choose *Undo last edit & restart* if it happened right after an edit, or *Restart*. Your project is safe on the server. |
| A level looks wrong after an edit | Undo it (`Ctrl+Z`, or the Edits tab), or restore a version (⋯ → Version history). |

## Editing

| Problem | What to do |
|---|---|
| Keys type into a field instead of moving things | Shortcuts never fire while a text field has the focus. Click the game or press `Esc`. |
| I can't find an object | Search for it in Objects (try other words: "bomb", "ghost", "crate"), or use the *All* category. |
| An original object can't be changed | A few of the game's objects can only be deleted, not changed. |
| A star is hard or impossible to reach | **Test → Check level** finds buried, floating and out-of-reach stars and offers a fix. |
| "Collision pool" or "object slots" warnings | The level has too many triangles or objects for the engine. Remove some blocks or make imported models simpler. |
| The top bar says *Offline · N changes waiting* | The server is not reachable. Keep working: the changes are sent when it is back. |
| Two tabs show different things | They sync live; if one was offline, reload it. |

## AI

| Problem | What to do |
|---|---|
| There is no chat | That is the no-AI mode: no AI is connected, or AI is turned off. Everything works without it. To use one, log in to Claude Code on the server machine (`claude`, then log in) or add a provider in ⋯ → AI assistant…. See [AI providers](ai-providers.md#using-studio-64-without-ai). |
| "No AI is connected" | The server found no Claude login and no provider. Same as above. |
| "AI is turned off on this server (STUDIO_AI=off)" | The server was started with `STUDIO_AI=off`. Start it without that variable. |
| A local model chats but does not build anything | Pick a model trained for tool calling (Qwen 3, Llama 3.1+, Mistral Small, GPT-OSS, ...); for llama.cpp start `llama-server` with `--jinja`. |
| The AI edited something wrong | Undo it like any edit: the Edits tab has an undo button per change. |

## Sharing

| Problem | What to do |
|---|---|
| The playable game shows nothing when opened from a folder | Browsers don't load WebAssembly from `file://`. Serve the folder: `python3 -m http.server` inside it, then open `http://localhost:8000`. |
| Others on my network can't open the studio | Start it with `HOST=0.0.0.0` (and a `STUDIO_PASSWORD`). Check your firewall. |

## Where are my files?

| | |
|---|---|
| Projects | `server/projects/<id>.json` (or `STUDIO_PROJECTS`) |
| Imported assets | `server/projects/assets/<id>/` |
| Versions | `server/projects/versions/<id>/` |
| Deleted projects | `server/projects/trash/` (the app never deletes them for good) |
| AI keys | `~/.config/studio64/ai.json` |
| The setup's state, log and uploads | `.setup/` in the Studio 64 folder |
| Tools the launchers and the setup downloaded (Node.js, Python, Zig, make, w64devkit) | `.runtime/` in the Studio 64 folder |
| The Emscripten compiler the setup installed | `~/.cache/studio64/emsdk` (macOS `~/Library/Caches/studio64/emsdk`, or `STUDIO_CACHE`) |
| Play-test saves (the game's save, your stars, story progress) | In the browser, mirrored to `server/projects/playsaves/<id>.json` |
| Save states | In the browser tab's memory |
