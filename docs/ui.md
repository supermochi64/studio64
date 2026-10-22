# Studio 64 interface

How the studio is laid out, what every key does, and how a new panel joins the product.
Code: `web/js/shell.js` (rail, palette, shortcuts, tooltips, tour), `web/js/dialogs.js`
(confirm/prompt replacements), `web/css/shell.css` (shell styles), design tokens in the
`:root` block of `web/css/app.css`.

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ★ Studio 64 │ Project name · Saved │ ● Level ▾ │  🔍 Search actions… Ctrl P │ ◫ Share ⋯ │  top bar
├──────┬───────────────────────────────────────────────────────┬───────────────┤
│ Play │                                                       │ Chat Edits ★  │
│ Build│                  the game (or a workspace)            │               │
│──────│                                                       │   messages    │
│ Story│                                                       │               │
│Assets│                                                       │               │
│ Sound│                                                       │  composer     │
│ Game │                                                       │               │
│      │                                                       │               │
│ Test │  controls hint                                        │               │
│ Help │                                                       │               │
└──────┴───────────────────────────────────────────────────────┴───────────────┘
 rail                          stage                               chat column
```

- **Top bar**: the project (name, saved state), the level you are in (click: level launcher),
  the command palette, the chat toggle, Share and the project menu (projects, versions,
  export, import).
- **Workspace rail** (left): one place for each part of a hack.
  - **Play**: the game and the chat. Click the game to play; `Esc` gives the mouse back.
  - **Build**: the mouse editor. The library on the left has a tool grid (Blocks, Objects,
    Terrain, Builds, World, Models, Logic, …); the inspector replaces it when something is
    selected; the build bar floats over the game (move/rotate/resize, snap, undo, redo, help).
  - **Story**: dialogs, characters, logic, cutscenes, game texts, start & end.
  - **Assets**: imported models, textures, materials, sky, Mario's colours.
  - **Sound**: songs (game music and your own compositions) and sound effects.
  - **Game**: the game rules (physics, moves, lives, coins, HUD) for the game or one level.
  - **Test** (bottom): play-testing tools (debug views, save states, timer, level check).
  - **Help** (bottom): the tour, the shortcut sheet, the command palette, AI settings.
- Story and Sound **dock into the stage**: the rail and the chat stay visible, so you can ask
  Claude while you write a dialog or compose a song. Assets opens as a drawer beside the chat;
  Game rules is a dialog. Clicking another workspace closes the open one.
- **Chat column** (right): Chat, Edits (history with undo), Stars of this level. Drag its edge
  to resize; `Ctrl+J` hides it for a bigger game.

### Without AI

AI is an optional assistant, never required. When it is switched off or no AI is connected,
`<body>` gets the class `no-ai` (the AI switch, `ai_settings.js`) and every element marked
`data-ai` disappears. The shell then:

- removes the chat column; the stage (game, editor, docked workspaces) takes the full width;
- keeps the **edit history** and **stars** as a side panel that starts closed (`Ctrl+J` or the
  panel button in the top bar opens it; it remembers its own open/closed state). On a phone it
  sits under the game and starts open;
- leaves Claude out of the tour (a history/stars step replaces the chat step), the loading tips,
  the hints, the shortcut sheet, the empty states and the command palette (no chat commands, no
  "ask Claude" fallback, no AI settings in Help).

Mark anything AI-only you add with the `data-ai` attribute.

### Small screens

Below 900 px wide the studio becomes **play + chat**: the game on top (4:3), the chat under
it with the composer pinned to the bottom. The rail is hidden; every workspace is still in the
command palette (the search button in the top bar). At 1280 px the chat column starts at 360 px.

## Finding things

- **Command palette** (`Ctrl+P`, or the search field in the top bar): every workspace and each of
  its pages (Story: Cutscenes, Assets: Textures, Sound: Sound effects, …), every build tool, the
  scene panel, the build bar actions, project actions (versions, export, import, share), chat actions,
  the world map, the level check, and every level by name. Type a few letters of any word;
  `↑` `↓` choose, `Enter` runs. If nothing matches, `Enter` hands the text to Claude.
  The last commands you ran come first.
- **Tooltips** show what a button does and its shortcut (from the `(Key)` at the end of its
  `title`). Rail tooltips open to the right.
- **Shortcut sheet** (`?`): every shortcut on one page.
- **Tour**: runs once on the first visit (skippable), and again from Help › Take the tour.
- **Keyboard only**: `Tab` is the Play/Build key while the game has the focus. `Shift+Tab` walks
  into the controls; from there `Tab` / `Shift+Tab` go through everything (top bar, rail, the
  buttons over the game, the side panel) and pass over the game itself. `Esc` on a control goes
  back to the game; `Esc` also closes menus and dialogs, and arrows walk menu items.

## Keyboard shortcuts

The main keys; the complete list (play-testing, terrain, path tool, player) is in
[Keyboard shortcuts](keyboard-shortcuts.md).

| Everywhere | |
|---|---|
| `Ctrl+P` | Command palette |
| `Ctrl+K` (or `L` when not playing) | Level launcher |
| `Tab` | Play ⇄ Build |
| `/` | Write to Claude |
| `Ctrl+J` | Show or hide the chat |
| `?` | Shortcut sheet |
| `Esc` | Close a panel, back to the game |
| `Y` · `M` · `P` | Story · Sound · Game rules (in build mode `P` plays from the spot under the mouse) |
| `F3` · `F2` | Play-test tools · debug view |

| Playing | |
|---|---|
| `W` `A` `S` `D` | Run |
| `Space` (or `K`) | Jump |
| `J` | Punch (B) |
| `Shift` (or `L`) | Crouch |
| `←` `→` | Camera |
| `Enter` | Pause |
| `F6` · `F7` | Save state · load state |

| Build camera | |
|---|---|
| Right-drag / middle-drag | Orbit around what is under the mouse |
| `Shift`+drag | Pan |
| Wheel, `Ctrl`+drag | Zoom toward the mouse |
| `Alt` + left/middle/right | Maya-style orbit/pan/zoom |
| `F` · `Home` · `Shift+Home` | Frame selection · Mario · whole level |
| Numpad `1` `3` `7` (`Ctrl` for the back) | Front · right · top view |
| Numpad `2` `4` `6` `8` | Orbit in 15° steps |
| Right mouse + `WASD` `QE` | Fly (`Shift` faster) |

| Build editing | |
|---|---|
| Click · drag | Select · slide over the ground (`Shift`: up/down) |
| `1` `2` `3` | Move · rotate · resize handles |
| `R` · `G` | Rotate 45° · drop to the ground |
| `Ctrl+D` · `Del` | Duplicate · delete |
| `Ctrl+Z` · `Ctrl+Shift+Z` | Undo · redo |
| `Ctrl+C` · `Ctrl+V` | Copy · paste (also between levels) |
| `O` | Scene panel: everything in this level |
| `P` | Play from the spot under the mouse |
| `Alt` while dragging | Ignore the grid |
| `[` `]` or `Alt`+wheel | Brush size (terrain) |

On a Mac, `Ctrl` is `⌘`.

## Design system

All colours, sizes and motion come from the tokens in `app.css :root`; new panels use them
instead of literal values.

| Token | Use |
|---|---|
| `--bg`, `--bg-2`, `--panel`, `--panel-2`, `--panel-3` | Surfaces, darkest to lightest |
| `--border`, `--border-2`, `--hover` | Hairlines, stronger outlines, hover wash |
| `--text`, `--text-2`, `--muted`, `--faint` | Text, from primary to hints |
| `--accent` (#ffc83d star yellow), `--accent-ink`, `--accent-soft`, `--accent-line` | The one highlight colour: active tool, current workspace, primary focus |
| `--green`, `--red`, `--blue`, `--purple` (+ `-soft`) | Success, danger, info, special |
| `--fs-2xs` … `--fs-3xl` | Type scale (10.5 → 32 px). Inter for text, JetBrains Mono for numbers |
| `--sp-1` … `--sp-8` | Spacing on a 4 px grid |
| `--r-xs` … `--r-xl`, `--r-pill` | Radii: 6 inputs, 10 buttons, 14 cards, 20 windows |
| `--shadow-sm/md/lg`, `--glow` | Elevation |
| `--ease`, `--dur-1/2/3` | Motion: 120 ms hover, 200 ms panels, 320 ms tour |
| `--focus-ring` | Keyboard focus (shown only while using the keyboard) |

Patterns every panel follows:

- **Window chrome**: a 52 px head with an accent-coloured icon, a segmented tab control
  (`--bg-2` track, `--panel-3` active tab) and a ghost close button with `title="Close (Esc)"`.
- **Buttons**: `.btn` (default), `.btn.primary` (one per view), `.btn.ghost`, `.btn.danger`,
  `.btn.sm`, `.btn.icon`. Icons are 24-grid line icons from `icons.js` (`icon(name, 'sm')`).
- **Section labels**: 11 px uppercase, `.08em` tracking, `--faint`.
- **Empty states**: say what goes here and offer the first action (a button, or "ask Claude").
- **Toasts** (`toast(text, icon)`): `check` → green success, `x` → red error that stays 6 s with
  a close button, anything else → neutral. Never `alert()`.
- **Dialogs**: `import { askConfirm, askText, askChoice, notify } from './dialogs.js'`, all
  promise based, never `confirm()`/`prompt()`. Tests answer them with
  `studioDialog.accept()`, `.cancel()` or `.answer(value)`.
- **Motion** respects `prefers-reduced-motion` (everything becomes instant).

## Adding a panel

1. Put a button in the top bar (anywhere: next to `#sound-btn` is customary) with an `id`, an
   icon, `<span class="hide-sm">Label</span>` and `title="Label: what it is (Shortcut)"`. The shell
   files it into the rail by itself, adds the label, tooltip and keyboard name, and keeps your click
   handler. To give it a fixed spot and an "open" state, add it to `WORKSPACES` in `shell.js`
   (`sel`, `label`, `icon`, `isOpen`, `close`).
2. A build tool: add a `.lib-tab` with `data-lib` to `#library .lib-tabs`; the shell gives it an
   icon (map `LIB_ICONS` in `shell.js`) and lays the tabs out in two rows when there are many.
3. Commands for the palette: `window.studioShell.register({ id, label, group, icon, keys, hint, run })`
   (wait for the `studio-shell-ready` event if your module loads first).
4. Overlays that take keys: push a handler on `window.studioKeyTraps` while open (dialogs.js does);
   it sees every key before the game and the panels.

## Screenshots

The README pictures in `docs/img/` come from `tools/ui_shots.mjs`, which drives a fresh project like
a user (two chat requests, a template level, Story, Sound, Assets, the no-AI view, the home screen).
Run it against a scratch server so the sample hacks it adds stay out of your projects:

```sh
PORT=8098 STUDIO_PROJECTS=/tmp/s64shots node server/index.js &
SEED=1 STUDIO_URL=http://127.0.0.1:8098 node tools/ui_shots.mjs     # NO_AI=1 skips the chat requests
```

`tests/suite/shell.test.mjs` checks the shell: rail, palette, sheet, tour, dialogs, Tab and
keyboard focus, no-AI mode, and no sideways scrolling from 390 to 1920 px.
