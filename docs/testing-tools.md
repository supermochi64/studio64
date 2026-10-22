# Play-testing and debug tools

The **Test** button (bug icon, or `F3`) opens the play-test panel over the game. It has three
tabs: **Tools**, **Save file** and **Check level**. Drag it by its head; it remembers the tab
and the overlays you turned on.

All of it works from the UI alone, without AI; the Claude tools listed at the end are an extra.

## Shortcuts

| Key | |
|---|---|
| `F2` | debug view on/off (collision, hitboxes, Mario info) |
| `F3` | the play-test panel |
| `F4` | restart the speedrun timer |
| `F6` / `F7` | save / load the quick save state (slot 1) |
| `F8` | pause / resume the game (frame advance) |
| `F9` | one frame forward (pauses first) |
| `F10` | slow motion: 1×, 1/2, 1/4, 1/8 |
| `P` (build mode) | play from the spot under the mouse |

They work while playing and building, never while typing in a field.

## Debug view (Tools → Show)

- **Collision**: the collision triangles around Mario (around the camera's focus in build
  mode), drawn over the game and colored by surface type: floors blue, walls orange, ceilings
  red, slippery / very slippery / not slippery, lava, death planes, hangable ceilings,
  quicksand, warps, water and wind each in their own color (legend in the panel). Triangles of
  moving objects (platforms, blocks) have a white edge.
- **Hitboxes**: every object's hitbox cylinder with its name (Mario red, your objects yellow,
  the level's own objects green).
- **Mario**: his action by name (`walking`, `triple jump`...) with the raw value, action
  state and timer, position, yaw, forward / horizontal / vertical speed, the floor's surface
  type and slope, the ceiling, health, coins, stars and the game frame.
- **FPS**: game frames per second (and the speed setting).
- **Timer**: a speedrun timer at the top of the game. It starts when Mario can move after
  entering a level, splits on each star (a star ends the run, like a course) and keeps your
  best time per level and project. It counts game frames, so pausing, slow motion and lag do
  not change the time.

## Time

**Pause** stops the game on the current frame (the picture stays); **Frame** runs exactly one
frame; **1/2 · 1/4 · 1/8** slow the game down. Build mode always runs at full speed.

## Save states

Three slots with a picture, level and time. **Save** copies the whole game (the WebAssembly
memory up to the heap's end, zero pages skipped; typically 40-80 MB, a few tens of
milliseconds), **Load** puts it back instantly, also from another level. The renderer's caches
are reset after a load, so textures and shaders are right on the next frame. Save states live
in the tab's memory (not on the server) and are meant for testing a jump twenty times.
If you edited the level after saving, the load says so: the state has the level as it was.
A cutscene never survives a load (one that was playing ends, and a state saved during a
cutscene comes back with Mario free to move).

## Play from here

- Build mode: **Play from here** in the build bar starts playing with Mario on the ground at
  the spot the camera looks at; `P` uses the spot under the mouse.
- Playing: *Play from the camera* in the panel puts Mario in front of the camera.

## Save file

The game's own save file: the total, quick buttons that give **0 / 1 / 3 / 8 / 30 / 50 / 70 /
120 stars** (filled course by course, for testing star doors), every course's stars to click
on and off, the castle's secret stars, **keys, cap switches and doors** (basement and upstairs
keys and doors, wing / metal / vanish cap, the star doors, moat drained, ...), the stars of
your own levels, *Reset save file* and *Forget your levels' stars*. Changes apply at once:
the star counter and doors follow.

## Check level (validator)

Runs when the tab opens (*Check again* re-runs). Problems are grouped by level, the level you
are in first, as errors, warnings and notes:

- In the level you are in (with the game's real collision; blocks count as ground):
  stars **under the ground**, stars **over the void**, stars **out of reach** (higher above
  the ground nearby than Mario can jump), stars or objects **inside walls**, objects **under
  the level**, red coin stars with **fewer than 8 red coins**, a red coin under the ground,
  **object slots** or the **collision pool** nearly full, a **start point over the void**.
- In every level (from the saved data): **pipes that lead nowhere**, a pipe's other end
  missing, **warps to deleted or unknown levels**, too many objects or removed originals for
  the engine's limits, levels without stars, levels no pipe leads to, edits of deleted levels.

Each problem has **Show** (goes to that level if needed, opens build mode looking at it and
selects the object) and, where there is a safe fix, **Fix** (lift a buried star onto the
ground, bring a star down within reach, or start Mario where he stands). The tab shows the
number of errors and warnings.

## For Claude

Tools in `server/tools/projects.js`: `validate_level` (the same check, with positions),
`play_from_here` (x/z or the camera's spot), `debug_view` (turn overlays on/off for the user),
`set_save_file` (stars, reset, flags), plus the version tools (`save_version`,
`list_versions`, `version_changes`). Browser side: `registerRpc` methods `validate`,
`play_from_here`, `debug_view`, `save_file` in `web/js/testing.js`.

## Code

- `web/js/testing.js` (panel, overlay drawing, timer, save states, save file, play from here),
  `web/js/validator.js` (the checks), `web/css/testing.css`.
- Engine: `engine/src/studio/debug.c`: `studio_debug_surfaces` (collision triangles near a
  point: vertices, type, floor/wall/ceiling, dynamic), `studio_debug_mario_json`,
  `studio_debug_speed` / `studio_debug_step` / `studio_debug_gate` (the web main loop asks it
  before each game frame, `src/pc/pc_main.c`), `studio_save_*` (stars, flags, coins, reset),
  `studio_debug_walls` / `studio_debug_ceil` / `studio_debug_floor_type` /
  `studio_debug_pools_json` (validator), `studio_heap_end` and
  `studio_before_state_load` / `studio_after_state_load` (save states; they call
  `gfx_studio_before_load` / `gfx_studio_invalidate` in `src/pc/gfx/gfx_pc.c`).
- Names: `web/data/debug_names.json` (actions, surface types, save flags) from
  `node tools/gen_debug_names.mjs`.

Test: `tests/suite/testing_tools.test.mjs` (overlay, pause, frame advance, slow motion, save
states with F7, save file, validator with planted problems, Fix, Show, play from here, `P`).
