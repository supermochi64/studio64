# Architecture

How Studio 64 is put together, for people who want to change it. If you only want to use it,
start with [Getting started](getting-started.md).

- [The big picture](#the-big-picture)
- [Repository map](#repository-map)
- [The engine](#the-engine)
- [The project and its patch](#the-project-and-its-patch)
- [How an edit travels](#how-an-edit-travels)
- [How edits are replayed](#how-edits-are-replayed)
- [The AI assistant (optional)](#the-ai-assistant-optional)
- [Extending Studio 64](#extending-studio-64)

## The big picture

```
┌──────────────────────────── browser ────────────────────────────┐        ┌──────────── Node server ────────────┐
│                                                                 │        │                                     │
│  web app (web/js)                    the game (web/engine)      │        │  server/index.js                    │
│  ┌──────────────────────┐  ccall    ┌──────────────────────┐    │  HTTP  │   static files, /api/...            │
│  │ app.js, shell.js     │ ───────▶  │ sm64ex as WebAssembly│    │ ◀────▶ │   projects (server/projects/*.json) │
│  │ editor.js (build)    │           │ + engine/src/studio/ │    │   ws   │   live hub: edits, undo, broadcast  │
│  │ engine.js (bridge)   │ ◀───────  │   studio_* API       │    │        │                                     │
│  │ studio.js (rpc)      │ Module.   └──────────────────────┘    │        │  optional: AI agent per project     │
│  └──────────────────────┘ studio*()                             │        │   server/agent.js, server/ai/,      │
│                                                                 │        │   server/tools/*.js (plug-ins)      │
└─────────────────────────────────────────────────────────────────┘        └─────────────────────────────────────┘
```

- The **game** is the SM64 PC port [sm64ex](https://github.com/sm64pc/sm64ex) compiled to
  WebAssembly, with Studio 64's editing code added in C (`engine/src/studio/`).
- The **web app** (plain ES modules, no bundler) is the editor around it. It talks to the game
  through exported C functions and keeps the project's edits in memory, because the game asks for
  them synchronously while an area loads.
- The **server** (Node, no framework) serves the app, stores projects as JSON files, relays edits
  between the tabs of a project over a websocket, and, only if an AI is configured, runs the
  chat assistant.

Everything a user can do works without the AI: the AI is an extra client of the same functions.

## Repository map

| Path | What it is |
|---|---|
| `engine/` | sm64ex (branch `studio`) with Studio 64's changes. Build: `npm run build:engine`. See [Building the engine](building-the-engine.md). |
| `engine/src/studio/` | Studio 64's C code: the editing API and all runtime features (below) |
| `engine/levels/studio/` | The empty level slot every custom level loads into (`LEVEL_STUDIO`, 37), with areas 1 to 7 |
| `web/` | The app: `index.html` (studio), `play.html` (standalone player), `js/`, `css/`, `data/` (generated game data), `thumbs/` (object pictures), `engine/` (build output, not checked in) |
| `server/` | The Node server: `index.js` (HTTP, websocket hub), `projects.js` (storage, edit history, undo), `agent.js` (AI tools), `ai/` (AI providers), `tools/` (AI tool plug-ins), `routes/` (HTTP/ws route plug-ins), `data/catalog.json` |
| `server/projects/` | Project files (not checked in; `STUDIO_PROJECTS` moves it) |
| `server/samples/` | Sample hacks (`.s64hack`) for the home screen |
| `tools/` | Generators and scripts: the object catalog, game data, thumbnails, the Sunshine converter (`tools/sms/`) |
| `tests/` | The test suite (`tests/suite/*.test.mjs`, runner `tests/run.mjs`). See [Testing](testing.md). |
| `docs/` | This documentation |

### The web app

| Module | Role |
|---|---|
| `web/js/app.js` | Boots everything: websocket, project, chat, edits list, keys |
| `web/js/shell.js` | Rail, top bar, command palette, shortcut sheet, tooltips, tour ([UI](ui.md)) |
| `web/js/engine.js` | Engine bridge: loads the wasm, wraps `studio_*`, keeps the patch, replays it on area load |
| `web/js/studio.js` | Placement math and the browser side of the AI tools (`registerRpc`) |
| `web/js/editor.js`, `editor_ui.js` | Build mode: camera, picking, handles, library, inspector |
| `web/js/generators.js` | Block materials and structure generators (shared by the editor and the AI) |
| `web/js/world.js`, `terrain.js`, `templates.js`, `levels_ui.js` | Custom levels, terrain, sculpting, templates, launcher, stars |
| `web/js/worldflow.js`, `world_ui.js`, `world_map.js` | Areas, warps, hub, zones, environment ([World](world.md)) |
| `web/js/objects/` | Motion, custom objects, scene panel, prefabs, game rules ([Objects](objects.md)) |
| `web/js/story/` | Dialogs, characters, events, cutscenes ([Story](story.md)) |
| `web/js/assets*.js`, `asset_*.js`, `texcodec.js`, `pixel_editor.js` | Model import, textures, skies, Mario's colours ([Assets](assets.md)) |
| `web/js/music.js`, `sfx.js`, `sound_ui.js` | Sound studio ([Sound studio](sound-studio.md)) |
| `web/js/testing.js`, `validator.js` | Play-test tools and the level check ([Testing tools](testing-tools.md)) |
| `web/js/savegame.js` | The project's play save (the game's save, your levels' stars, story progress), mirrored to the server (`server/routes/playsave.js`) |
| `web/js/hub.js`, `player.js` | Home screen, sharing, offline queue, crash recovery; the standalone player ([Projects](projects.md)) |
| `web/js/ai_mode.js`, `ai_settings.js` | AI on/off and the AI settings dialog ([AI providers](ai-providers.md)) |

## The engine

`engine/` is sm64ex built with `TARGET_WEB=1`. Studio 64 adds its code in `engine/src/studio/`
and small hooks in the game's own files (marked with `studio_` calls):

| File | Role |
|---|---|
| `studio.c` | The live editing API: spawn any catalog object, delete, move, removal rules for original objects, warp nodes, terrain queries, object lists, the area-load callback |
| `editor.c` | Blocks (generated meshes and collision), mouse picking (ray vs. collision and objects), the editor camera, the build-mode pause |
| `world.c` | Custom levels in `LEVEL_STUDIO`, heightmap terrain, sculpting of original levels, sky/music/water/spawn, studio stars |
| `flow.c` | Warps, locks, zones, paintings, keys, fog/light/weather, camera modes ([World](world.md)) |
| `motion.c`, `actor.c`, `rules.c` | Motions and paths, custom objects, game rules ([Objects](objects.md)) |
| `story.c` | Dialogs, characters, events, cutscenes, game texts ([Story](story.md)) |
| `assets.c` | Imported models, texture overrides, skies, Mario's colours ([Assets](assets.md)) |
| `audio.c` | Composed songs and replaced sounds |
| `debug.c` | Collision/hitbox debug data, frame stepping, save states, save file ([Testing tools](testing-tools.md)) |
| `sms/` | Super Mario Sunshine characters ([Sunshine](sunshine.md)) |
| `shoggoth/` | Tokyo from a Shoggoth World checkout: the city object, its collision and city life ([Tokyo template](tokyo-template.md)) |
| `gen/catalog.inc.c` | The object catalog table, generated by `tools/gen_catalog.py` |

**Page → engine.** C functions marked `EMSCRIPTEN_KEEPALIVE` are called from JavaScript as
`Module._studio_spawn(...)` or through `ccall`. They always run between frames. Functions that
return data return a JSON string (`engine.json('studio_debug_mario_json')`).

**Engine → page.** The engine calls back into the page with `EM_ASM` on `Module.studio*`
functions that `web/js/engine.js` sets up: `studioAreaLoad` (an area loaded),
`studioStarCollected`, `studioWarp` (every warp asks the page where it goes), `studioIntro` /
`studioIntroStars` (the star screen), `studioPauseLevels`, `studioStarInfo`, `studioNpcDialog` and
`studioStoryEvent` (story), `studioObjectEvent` (custom objects), `studioSfx` (replaced sounds),
`studioKeysBlocked` (keyboard focus), `studioAfterFrame`.

**Every model in every level.** The game normally loads only the models a level needs. Studio
64's catalog links every model with its geo layout or display list, so any object can be spawned
in any level.

## The project and its patch

A project is one JSON file, `server/projects/<id>.json`. The parts that matter most:

```js
{
  id, name, boot: { level, act },
  areas: {                      // the patch: one entry per area that has edits
    "9:1":        { objects: [...], removals: [...], warps: [...], settings, sculpt, paths, ... },  // an original level: "<level>:<area>"
    "c:k3Jd9x":   { objects: [...], terrain, settings, ... },                                     // a custom level, area 1
    "c:k3Jd9x:2": { ... },                                                                         // its area 2
    "@game":      { rules, objdefs, prefabs },                                                    // game-wide: rules, custom objects, prefabs
  },
  levels: [{ id, name, template, areas }],   // custom levels
  changes: [...], redo: [...],               // the edit history (undo/redo)
  world, story, assets, audio, thumbs,       // world flow, story, imported assets, sound studio, level pictures
  chat, aiHistory, model, sessionId,         // AI only
}
```

- **Records** (`objects`) are things Studio 64 spawns: `{ uid, entry | bhv + model, x, y, z, ry,
  bparams, ... }` plus optional fields that features add (`block`, `star`, `warp`, `motion`, `zone`,
  `asset`, ...). The `uid` identifies a record across tabs, undo and links.
- **Removals** are rules that stop an original object from spawning: a behavior, a position and a
  radius. Moving or changing an original object is a removal plus a record.
- **Warps** are warp nodes the area needs (pipes).
- A feature that stores data keeps it in the project JSON (any key) and binary files in
  `server/projects/assets/<id>/`; export, import, duplicate, delete and versions then include it
  without extra code ([Projects](projects.md#project-file-s64hack)).

## How an edit travels

1. **In the browser**, the editor changes the running game right away (spawns, moves or deletes
   through the engine API), so there is no waiting.
2. It sends the edit to the server over the websocket: `{ type: 'edit', op }` with `op.type` =
   `add`, `remove`, `update`, `update_many`, `area` (terrain, settings, rules, ...) or `sculpt`.
3. **The server** (`server/index.js`) stores it with `projects.recordChange()` /
   `updateObject()` / `updateArea()` / `addSculpt()`: the patch changes and the change goes into
   the history with what undo needs. Projects are written atomically (temp file and rename).
4. It broadcasts the new patch to every tab of the project, and `apply_ops` to the other tabs so
   they update their running game too.
5. **Undo** (`{ type: 'undo', changeId }`) reverts one change on the server
   (`projects.undoChange`) and broadcasts the ops that put every tab's game back.

Other data has its own messages (`level_create`, `story_op`, `song_save`, ...) or REST routes
(assets, projects, versions). Changes outside the levels (story, assets, audio, world flow) are
undoable too: they are stored as project-wide changes (`key: '@project'`, with the field's state
before the change; see [Projects](projects.md#version-history)).

When the server is unreachable, edits wait in the browser (`localStorage`) and are sent when it
comes back ([Projects: robustness](projects.md#robustness)).

## How edits are replayed

SM64 rebuilds an area from its level script every time it loads: after a warp, a death, a star.
Studio 64 hooks that moment:

1. The game's area loader (`src/game/area.c`) calls `studio_on_area_load()`, which calls
   `Module.studioAreaLoad(level, area)`.
2. `Engine._areaLoad` in `web/js/engine.js` finds the area's patch key (`9:1`, `c:<id>`,
   `c:<id>:2`) and runs `_applyArea`:
   - **level hooks** set up terrain, sculpting and settings (`web/js/world.js`, `worldflow.js`, ...),
   - **removal rules** go to the engine (`studio_add_removal`), so the original objects they
     match never spawn,
   - **warp nodes** are registered (`studio_add_warp_node`),
   - every **record** is spawned (`_spawnRecord`), where feature modules can take over special
     records through `engine.spawnFilters`,
   - **after-area hooks** run last (imported models, story state, ...).
3. Listeners of the `area` event (UI updates) run after the engine finished loading.

Because everything is replayed from the patch, an edit survives reloads, deaths and level changes,
and the same code runs in the standalone player (`web/play.html`), which loads the patch from a
file instead of the server.

## The AI assistant (optional)

When an AI is configured, the server runs one agent per project (`server/agent.js`):

- Claude models run through the Claude Agent SDK; any other provider runs through Studio 64's own
  loop (`server/ai/loop.js`). Both use the same tool list. See [AI providers](ai-providers.md).
- A tool runs on the server and asks the browser of the user who sent the message to do the game
  work: `rpc(method, params)` sends `{ type: 'rpc' }` over the websocket, the browser's
  `Studio.handle()` (`web/js/studio.js`) runs it against the live game and answers with
  `rpc_result`.
- Tools that change the hack store their records with `commit()`, the same `recordChange()` the
  editor uses, so AI edits appear in the Edits list and undo like hand edits.
- The AI only gets the studio tools: no shell, files or web access.

With `STUDIO_AI=off`, or when no AI is connected, or when the user switched it off, none of this
runs and the app hides every AI element (`body.no-ai`, `[data-ai]`).

## Extending Studio 64

See [Extending Studio 64](extending.md) for:

- **AI tool plug-ins** (`server/tools/*.js`) and their browser side (`registerRpc`),
- **route plug-ins** (`server/routes/*.js`) for HTTP and websocket messages,
- **commands** in the command palette (`window.studioShell.register`),
- **panels** and the design system ([UI](ui.md#adding-a-panel)),
- **catalog objects** ([Adding catalog objects](adding-objects.md)).
