# Settings

Studio 64 is configured with environment variables, set when you start the server:

```sh
PORT=9000 STUDIO_PASSWORD=secret npm start
```

## Server

| Variable | Default | |
|---|---|---|
| `PORT` | `8064` | The port the studio listens on (without `PORT`, `npm start` and the launchers take the next free port when 8064 is used by another program) |
| `HOST` | `127.0.0.1` | `0.0.0.0` makes it reachable from other devices. Set a password then. |
| `STUDIO_PASSWORD` | none | When set, the app asks for it before anything else (also for the API) |
| `STUDIO_ALLOWED_HOSTS` | none | Extra host names the studio answers to without a password (comma-separated). Without a password it answers only on `localhost` and IP addresses, and never to requests from other websites (protects against DNS rebinding and cross-site requests). |
| `STUDIO_PROJECTS` | `server/projects` | Where projects, versions, assets and the trash are stored |
| `STUDIO_SNAPSHOT_MINUTES` | `10` | How often an automatic version is saved while a project is edited |

## AI (all optional)

| Variable | Default | |
|---|---|---|
| `STUDIO_AI` | on | `off` turns every AI feature off for everyone: no chat, no AI settings, no AI hints |
| `STUDIO_MODEL` | `claude-opus-5-5` | The default model for new projects (also `@provider/model`, e.g. `@ollama/qwen3:8b`) |
| `STUDIO_AI_CONFIG` | `~/.config/studio64/ai.json` | Where AI providers and keys are stored (file mode 0600) |
| `STUDIO_AI_LOCKED` | off | `1`: the AI settings can't be changed from browsers (edit the file instead) |
| `STUDIO_CLAUDE` | auto | `on`/`off` overrides the detection of a Claude Code login |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY`, `VLLM_API_KEY` | | Provider keys, instead of typing them into the AI settings dialog |
| `OLLAMA_HOST` | `http://localhost:11434` | Where Ollama runs |

See [AI providers](ai-providers.md).

## Setup and building

| Variable | Default | |
|---|---|---|
| `STUDIO_OPEN` | on | `0`: `npm start` does not open a browser |
| `STUDIO_CACHE` | `~/.cache/studio64` (macOS `~/Library/Caches/studio64`, Windows `%LOCALAPPDATA%\studio64`) | Where the first-run setup installs the Emscripten SDK |
| `STUDIO_SETUP` | on | `off`: never show the first-run setup page (the server serves the studio even without a built game) |
| `STUDIO_SETUP_EXTRAS` | on | `off`: the setup skips the pictures and the sample hacks (they need a Chrome-family browser to render with; the tests use this) |
| `STUDIO_NO_MENU` | off | Linux launcher: `1` does not add Studio 64 to the applications menu |
| `STUDIO_NODE` | auto | The launchers: `system` uses only the Node.js on `PATH`, `private` always downloads their own into `.runtime/node` |
| `STUDIO_TOOLCHAIN` | auto | `private`: use the downloaded Python, Zig and make in `.runtime/` even when the system has its own (tests) |
| `STUDIO_RUNTIME` | `.runtime` in the Studio 64 folder | Where the launchers and the setup keep the tools they download |
| `STUDIO_BUILD_HOST` | native | Windows only: `wsl` builds in WSL instead of with w64devkit |
| `EMSDK` | found automatically | The Emscripten SDK used by the setup and `npm run build:engine` (otherwise `~/.local/src/emsdk`, then the setup's cache) |
| `STUDIO_JOBS` | number of CPU cores | Parallel compile jobs of the engine build |
| `CHROME` | found automatically | The Chrome/Chromium/Edge the picture and sample tools (and the tests) drive |
| `SMS_ISO` | | Your Super Mario Sunshine disc image, for `tools/sms/convert.py` by hand |
| `SHOGGOTH_DIR` | `../sm64-master` | A Shoggoth World checkout for `npm run shoggoth:refresh` (developers only: the Shoggoth content ships with Studio 64) |

See [Getting started](getting-started.md#the-setup-page) and
[Building the engine](building-the-engine.md).

## Tests

| Variable | Default | |
|---|---|---|
| `STUDIO_URL` | the runner starts its own server | Test against a server that is already running |
| `TEST_JOBS` | `3` | How many tests run at once |
| `CHROME` | found automatically (`tools/lib/browser.mjs`) | The browser the tests drive |
| `HEADFUL` | off | `1` shows the browser |
| `KEEP_PROJECTS` | off | `1` keeps the test run's projects folder |

See [Testing](testing.md).
