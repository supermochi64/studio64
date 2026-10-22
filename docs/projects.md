# Projects, versions, sharing and export

Everything around a hack: the home screen, project settings, version history, the project
file, the standalone playable game, and what keeps work safe (offline edits, crash recovery).

Everything here works from the UI alone, with no AI connected; Claude's tools (below) are an extra.
AI-only bits of these screens (chat mentions, "include the chat") carry `data-ai` and hide when AI is off.

## Home screen

Open it with the **Studio 64** logo (top left), *All projects* in the ⋯ menu, or `/?home`.
It also opens by itself when there is no project to continue.

- **Start a new hack**: *Castle* (the original game to remix, starting in the castle grounds),
  *From scratch* (a hack without the castle: pick a landscape for its first level; the hack
  starts there), and the **sample hacks** (finished examples to play and take apart). **Showcase**
  uses every feature at once (story with a talking Toad and cutscenes, a one-star door into a sub-area
  with its own song, a painting with its own picture to a second level with its own rules, a custom
  enemy on a patrol path guarding a hidden star, an elevator, imported crates, a texture, a sky and
  Mario's colours, the ending). Samples are generated (`npm run samples`); a server without them
  simply shows none.
- **Your hacks**: cards with the cover picture (or the newest level screenshot), author, last
  edit, levels and edits. Click to open; ⋯ (or right-click) for *Rename*, *Settings*,
  *Duplicate*, *Export project file*, *Download playable game* and *Delete*.
- **Search** (or `/`) filters by name, author and description; *Recent* / *Name* sorts.
- **Delete** asks inside the app, then shows an *Undo* toast. Deleted projects go to
  `server/projects/trash/` (never removed for good by the app).
- Projects without any edit, level or name are **empty drafts**: hidden behind *Show N empty
  drafts*, with *Delete empty drafts* to clean up.
- **Import**: the *Import* button, or drop `.s64hack` files anywhere on the home screen.
  One file opens right away.

## Project settings

⋯ → *Project settings* (or ⋯ on a home card): name, author, description, a **cover picture**
(upload an image, or *Game view* takes what the game shows right now; 960×540 JPEG) and
**Starts in** (an original level, or one of your own levels: "from scratch" hacks start there).
The cover and description appear on the home card, in the version file and on the title card
of the playable game. Without a cover, the home card shows a still of the hack's [title screen](title-screen.md)
when it has one.

## Version history

- **Automatic**: while a project is open, a snapshot is saved every 10 minutes when something
  changed (`STUDIO_SNAPSHOT_MINUTES`). The last 40 automatic ones are kept.
- **Save version…** (⋯ menu, or Claude's `save_version` tool): a named snapshot, kept for good.
- **Version history** (⋯ menu): versions by day; pick one to see **what changed** from it to
  now (or to a later version): objects added/removed/moved per level, original objects removed,
  warps, terrain, sculpting, level settings, new/deleted/renamed levels, songs and sounds,
  project settings and any other part of the project (story, rules, assets...).
- **Restore** puts the whole hack back to that version. The current state is saved as a version
  first ("Before restoring …"), so a restore can itself be undone. Every open tab reloads.
- Rename a version (named versions are never thinned out) or delete it.

A version holds the whole project JSON except the chat and the Claude session. Stored in
`server/projects/versions/<id>/` (`index.json` + one gzipped JSON per version).

**Undo / redo** (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) step through single edits; level operations
(create, rename, duplicate, delete) are undoable too: undoing a delete brings the level back
with all its edits. The same goes for sub-areas (made, renamed, deleted) and for everything
outside the levels: story edits, imported models, game textures, block materials, skies,
Mario's colours, the world flow (start, hub, star goal, pictures), songs and sounds, game rules
and custom objects. Ctrl+Z in build mode (or with the Story panel or the sound studio open)
undoes the newest edit of the area you are in **or** of the whole project, whichever came
last; the Edits list shows project-wide edits as *Project* / *Whole game* and can undo any
single one. Quick edits of one thing in a row (typing a dialog, dragging a colour slider) are
one step. Asset files that an edit deleted wait in `server/projects/trash/assets/<id>/` (not
exported) and come back with the undo or a version restore.

How: a project-wide change is `{ key: '@project', project: { path: ['story'] | ['assets', 'textures'] | ['world'] | ['audio'], before } }`
(`projects.recordProjectChange`); undo puts `before` back and the server sends the field again
(`story`, `assets`, `audio` or `patch` messages), so every tab re-applies it live. The last 40
of these snapshots stay undoable.

## Project file (.s64hack)

⋯ → *Export project file*, or *Share → Project file* (optionally without the chat). A zip:

| Entry | |
|---|---|
| `manifest.json` | `{ format: "studio64-hack", version: 2, name, author, description, levels, edits, files }` |
| `project.json` | the whole project (every key: areas, levels, audio, story, assets, rules, chat, edit history, ...) except the Claude session and the redo stack |
| `cover.jpg` | the cover picture, if any |
| `files/...` | every file that belongs to the project, path relative to `server/projects/` with the project id written as `{id}` (e.g. `files/assets/{id}/files/abc.png`) |

Importing makes a new project (new id); ids inside the project JSON that point to the old project
(asset links...) are rewritten, files are put back under the new id. The first export format
(`.studio64.json`) and bare project JSON files import too.

**For features that store data**: keep it in the project JSON (any key) and binary files in
`projects.assetDir(id)` (`server/projects/assets/<id>/`). Export, import, duplicate, delete
and versions then include it without any extra code. Any path under `server/projects/` with a
segment equal to the project id counts as the project's file.

## Playable game (standalone export)

*Share → Playable game* or ⋯ → *Download playable game*: `<name>-playable.zip`, a static website:

```
index.html            the player (web/play.html): title card, the game, the level list
js/                   player.js and the modules it imports (engine, world, objects, assets, story...)
engine/               sm64.us.f3dex2e.js + .wasm
data/                 hack.json (the project without chat and history), catalog.json, game data
assets/project/       the project's files
thumbs/levels/        pictures of the original levels for the level list
README.txt            how to host it, controls, and the Nintendo note
```

Put the folder on any static host (GitHub Pages, itch.io, a USB stick with a web server). It
needs no server code and works offline; only `file://` does not work (browsers do not load
WebAssembly from files): `python3 -m http.server` in the folder is enough.

The player runs the same runtime as the studio without the editor and chat: terrain, sculpting,
level settings, composed songs, replaced sounds, custom objects and game rules, imported
assets, warps between levels, story events, studio stars (progress saved per browser). A hack with a [launch screen](title-screen.md) shows it instead of the
player's title card (splash screens while the game loads, the title, the file select). `L` opens
the level list (your levels and the edited original ones), `F` fullscreen.

*Try the player* (Share dialog) opens it on the server: `/play.html?p=<project id>`.

> **The playable game contains Nintendo's copyrighted code, graphics and sounds** (it is built
> from your own Super Mario 64 ROM). Play it yourself or share it privately with friends; do not
> upload it publicly or sell it. The app shows this warning wherever it is exported, and the
> zip's README.txt repeats it.

## Decomp export (real ROM builds)

⋯ → *Export for the decomp*: the edits of the **original levels** as level script C for the
[SM64 decompilation](https://github.com/n64decomp/sm64). The dialog lists the files and notes;
*Download .zip* gives:

- `levels/<level>/studio_area_<n>.inc.c`: one sub-script with a `WARP_NODE` per pipe warp and an
  `OBJECT(model, x, y, z, rx, ry, rz, bparams, behavior)` per added object (stars keep their star
  index in the parameters), then `RETURN()`. Comments say where it goes: `#include` it in that
  level's `script.c` and add `JUMP_LINK(studio_area_<n>),` inside the `AREA(<n>, ...)` block.
- `NOTE` lines for what a level script cannot hold: original objects you removed (delete them from
  the script or macro objects by hand), blocks, terrain and sculpting (custom geometry), scaled
  objects, level settings, models the level does not load (`LOAD_MODEL_FROM_GEO` needed), and
  warps to your own levels.
- `README.txt` with the overview.

The test compiles the export of every catalog object against the decomp's headers
(`engine/include`), so model and behavior names are right. Not exported: your own levels (they
would need new collision, display lists, textures and a level slot) and Studio 64's own objects
(Sunshine characters, custom objects).

**sm64ex PC port**: sm64ex has no level-mod format (only texture packs, and DynOS actors in some
forks), so there is no mod file to make; the playable game above is the port of a hack to the
web, and the decomp export is the way into native builds.

## Robustness

- **The play-test save** (`web/js/savegame.js`): the game's save file (stars of the original courses,
  keys, caps, opened castle doors), the stars, keys and unlocked doors of your own levels and the story
  progress belong to the project (before, every project shared one game save). The browser keeps them
  in localStorage and the studio mirrors them to the server (`server/projects/playsaves/<id>.json`, not
  in versions or exports), so clearing the browser's storage or opening the project in another browser
  keeps the progress (the newer copy wins on load). *Play from start* and the F3 panel's *Reset save
  file* reset all of it together. The standalone player keeps its save per hack in the browser and has
  **New game** in its level list.

- **Offline edits**: when the connection to the server drops, edits keep working; they wait in
  the browser (also across a reload: `localStorage`) and are sent, oldest first, as soon as the
  server is back. The top bar says *Offline · N changes waiting*.
- **Reloading right after an edit**: edits that wait (typed story text, songs, sounds, the title
  screen) are sent when the page goes away, with keepalive requests that outlive the page.
- **History size**: terrain undo is stored as the changed cells only, redo keeps only what it
  needs, and the edit history keeps the last 1500 edits (big undo data within 4 MB); versions are
  the long-term safety net.
- **Server restarts**: the app reconnects by itself (backoff up to 8 s) and resynchronises.
  The server writes projects atomically (temp file + rename), flushes on SIGINT/SIGTERM and
  on an uncaught exception.
- **Several tabs** on one project see each other's edits live (existing hub); restoring a
  version or deleting the project reaches every tab.
- **Engine crash**: a friendly card ("The game crashed") with *Undo last edit & restart*,
  *Restart in the castle* and *Restart* (automatic after 10 s; hovering the card stops the
  countdown). A second crash in the same level within 3 minutes does not auto-restart. A game
  that stops drawing for 8 s (and is not paused by the debug tools) shows the same card.
- A server tool plug-in that fails, or a tool name defined twice, no longer stops the chat
  from starting (logged once).

## Server API

| | |
|---|---|
| `GET /api/hub/projects` | projects for the home screen |
| `GET /api/hub/samples`, `GET /api/hub/samples/<file>/cover` | sample hacks (`server/samples/*.s64hack`, made by `npm run samples`; a copy gets the sample's cover) |
| `POST /api/hub/create` | `{ name, author, template: empty\|scratch\|sample, level, levels: [{ name, template, area }], startInLevel, sample }` → `{ id }` |
| `POST /api/hub/import` | raw body: a .s64hack / json → `{ id, name }` |
| `GET /api/projects/:id/info` | name, meta, stats, boot |
| `POST /api/projects/:id/meta` | `{ name, author, description, cover: dataURL\|null, boot }` |
| `GET /api/projects/:id/thumb` | the cover or newest screenshot |
| `POST /api/projects/:id/duplicate`, `DELETE /api/projects/:id`, `POST /api/projects/:id/undelete` | |
| `GET /api/projects/:id/export.s64hack[?chat=0]` | the project file |
| `GET /api/projects/:id/standalone.zip`, `GET /api/projects/:id/play.json` | the playable game, its data |
| `GET /api/projects/:id/decomp.zip[?list=1]` | the decomp export (or its files as JSON) |
| `GET/PUT /api/projects/:id/playsave` | the play-test save (`{ v, t, eeprom, stars, story }`) |
| `POST /api/projects/:id/send` | `{ client, messages: [...] }`: project changes from a page that is closing (`fetch` keepalive), handled like websocket messages |
| `GET/POST /api/projects/:id/versions` | list / save `{ label }` |
| `GET /api/projects/:id/versions/:v/diff?against=current\|<v>` | what changed |
| `POST /api/projects/:id/versions/:v/restore`, `PATCH` (rename), `DELETE` | |

Code: `server/routes/projects_hub.js` (routes), `server/hackfile.js` (file formats, duplicate,
delete, standalone), `server/versions.js`, `server/decomp.js`, `server/zip.js`; `web/js/hub.js` + `web/css/hub.css`
(home, dialogs, offline queue, crash recovery), `web/play.html` + `web/js/player.js` +
`web/css/play.css` (the player). Route plug-ins: `server/routes/README.md`.

Claude's tools: `save_version`, `list_versions`, `version_changes` (server/tools/projects.js).

Tests: `tests/suite/projects_home.test.mjs`, `standalone.test.mjs`, `samples.test.mjs`,
`robustness.test.mjs`, `decomp_export.test.mjs`.
