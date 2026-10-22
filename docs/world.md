# World: areas, warps, hub and environment

How a hack's levels and areas connect, how it flows from the start to the end, and what each
area feels like. Everything here is saved in the project, re-applied whenever an area loads,
works in the player (`play.html`) and in exports, and Claude can do all of it from the chat.

## Where it lives

| | |
|---|---|
| `web/js/worldflow.js` | the logic: areas, warp records, the warp hook, hub returns, zones, locks, keys, environment, the world graph, the browser side of Claude's tools |
| `web/js/world_ui.js` | the **World** tab of build mode, the warp inspector, the destination picker, placing, the overlay labels and links |
| `web/js/world_map.js` | the world map (graph view) |
| `web/css/world.css` | their styles |
| `server/world_store.js`, `server/routes/world.js` | sub-areas and the world flow on the server (`area_create`, `area_rename`, `area_delete`, `world_set`) |
| `server/tools/world.js` | Claude's tools |
| `engine/src/studio/flow.c` | the engine side: warp hook, locks and their messages, zones, paintings, keys, fog/tint/light, weather, water and gas boxes, death height, camera modes, ambient sound |
| `engine/levels/studio/script.c` | the custom level slot now has areas 1..7 |
| tests | `tests/scripts/world_doors.mjs`, `world_flow.mjs`, `world_env.mjs`, `world_ui.mjs`, `world_look.mjs`, `world_tools.mjs` (helpers in `tests/lib/world_lib.mjs`; screenshots in `tests/out/`) |

## Areas

A custom level has up to 7 areas, like SM64's sub-areas (the inside of a building, a cave, a
secret room). Area 1 is the level's main area (patch key `c:<id>`); the others are
`c:<id>:<n>`. Each area has its own terrain, objects, sky, music, water, spawn, environment and
camera. The level list on the server keeps `levels[i].areas = [{ index, name }]` (and
`mainAreaName`).

- **World tab → Areas**: the level's areas with pictures; click one to go there (build mode
  comes back with the camera you had there). **New area** offers Room, Castle hall, Small
  house, Cave, Empty and every level template, and can put a door pair between here and there.
  The ⋯ menu renames or deletes an area.
- Stars of all areas count for the level (star select screen, castle pause pages, level
  cards); the 100 coin star belongs to the main area.
- Deleting a level deletes its sub-areas; duplicating it copies them (doors and pipes between
  the copy's areas lead inside the copy). Making, renaming and deleting an area are undoable
  (Edits list); undoing a delete brings the area back with its edits.
- Everything that lists a level's content covers its areas: star screen, pause pages, level
  cards, the F3 save tab, the validator (problems named "Level · Area"; warps to a deleted
  area are errors), the Edits list, version diffs, the player's level list and the project file.

## Warps

Warps are ordinary records with a `warp` field, so they move, rotate, duplicate and undo like
everything else:

```js
{ uid, bhv: 'bhvDoorWarp', model: 'door:castle_door', bparams: node << 16, ...,
  warp: { kind: 'door', style: 'castle', node: 0x80, to: { custom, area, uid }, stars: 3, key: 0, locked: false } }
```

| kind | what it is |
|---|---|
| door | `bhvDoorWarp` (or `bhvDoor` while it leads nowhere) with one of 10 door models (wooden, castle, star, one-star, three-star, key, metal, haunted, cabin, cave). Mario opens it and walks out of the other door. A door put flat on a wall works: Mario stops in the doorway instead of walking into the wall, and comes out of a door on its open side. |
| pipe | the game's warp pipe |
| painting | `bhvStudioPainting`: a canvas (the castle's 11 course paintings or your own picture: *Use your own picture* in its inspector, stored 128×128 in `patch.world.pictures`) that ripples when Mario comes close and swallows him when he jumps into it, with the star sound and a white fade |
| zone (warp zone) | an invisible box; walking in warps with a white fade, a star wipe, a circle, or **instantly** (same area: Mario keeps his speed and the camera jumps along) |
| arrival | where Mario comes out (standing, spinning down or falling in) |
| exit | a box that leaves the level for the hub |
| cannon, key | the game's cannon (placed ones stand on the ground: the game's own sit in a pit and rise out of it; Mario walks or drops in, A shoots); a key Mario collects (`bhvStudioKey`, key number in bparam 1) |

`to` names the destination: `{ custom, area, uid }` (a warp object there), `{ custom, area }`
(the area's start), `{ level, area, node }` for original levels, or `{ hub: true }`. Doors and
pipes linked to another door or pipe lead back (two-way).

How it works: every area load registers a warp node per record (`node` 0x80..0xDF, unique per
area) with the engine. Custom levels all share `LEVEL_STUDIO`, so the engine asks the page on
every warp (`initiate_warp` → `studio_warp_hook` → `Module.studioWarp(src, level, area, node,
exitCourse)`); the page answers with `_studio_warp_redirect(level, area, node, force, intro)`
and remembers the custom level the slot shows next (`engine.pendingCustom`, applied when the
area loads).

**Linking**: select a warp, **Link…** opens the destination picker (the hub, your levels and
their areas, the original levels, with pictures). Pick an area: you go there in build mode and
click where Mario comes out (an arrival point is made there), or click a door or pipe to connect
both ways, or *Use the level's start*; then you're taken back to the warp. *Go there*, *Unlink*
and *To the hub* are next to it. In build mode, labels above warps show where they lead (red
when not linked) and dashed arcs connect warps of the same area.

**Requirements** (the inspector's *Needs*): a number of stars ("It takes the power of N Stars
to open this. You need M more Stars." — the star counter includes studio stars), a key (1-8;
"You need a key to open this door.", once collected the door stays unlocked), or **Locked**
(opened by an event). Doors, pipes, paintings and warp zones all take them.

**Locks for events** (the story's events, or Claude's `lock_door`):
`studio64.worldFlow.setLocked(uid, locked, { persist })`, `isLocked(uid)`, or the RPC
`door_lock { uid, locked, persist }`. Without `persist` it lasts until the page reloads. The story's
*Open a door* / *Lock a door* actions use it without `persist` and keep the state in the save's story
progress (`progress.locks`), applied again on every area load, so an opened door stays open for that
save (and a fresh save starts with the doors as built).

## Hub and flow (`patch.world`)

```js
{ start: { custom | level, area }, hub: { custom | level, area }, goal: { stars, message }, pictures: { id: { name, data } }, hideZones }
```

- **Start**: where a new game begins (also written to the project's boot level, which the
  player and the project home use). *Play from the start* resets progress and goes there.
- **Hub**: stars (course complete), deaths, falling off and **Exit Course** return here, in
  front of the door, pipe or painting Mario left through (return points 0xE0 star / 0xE1 death /
  0xE2 exit are placed when the hub loads). A custom hub pauses like the castle (with the
  custom levels' pages) and has no star select screen. With your own start and hub, the hack
  never visits the castle.
- **Star goal**: when the star counter reaches it, the message shows in the game's dialog box
  once (and a toast).

## Zones

Block records with a `zone` field, so they are placed, moved and resized like blocks (handles,
inspector sizes). In build mode they are translucent coloured boxes (the *Show zones* switch
hides them); while playing they are invisible.

| zone | while playing |
|---|---|
| warp, exit | the engine watches the box (edge-triggered: standing in one when it appears does nothing) |
| arrival | the warp object Mario comes out of |
| death | falling in = falling off the level (a life, or "falling leads to") |
| camera | inside, the camera switches mode (see below), back to the area's mode outside |
| water, gas | environment boxes (water ids 40..47, gas 100) put before the level's own regions, so a pool inside a level with a sea keeps its surface; water shows a surface, gas a yellow haze |
| lava, quicksand | a burning lava / sinking sand surface at the top of the box |

## Environment of an area (`settings.env`)

| field | |
|---|---|
| `fog: { on, color, near, far }` | applied by the renderer to every depth-tested draw (not the sky or the HUD); overrides the original levels' fog colours too |
| `light: { yaw, pitch, color, ambient, tint }` | the sun the terrain, blocks and imported models are shaded with (direction, colour, ambient; blocks and models relative to their default shading) and a tint over the whole 3D scene (night, dusk, caves) |
| `weather` | none, snow, blizzard, rain, leaves, petals, lava_bubbles, bubbles, snow_water (the game's envfx node is taken over; rain, leaves and bubbles are drawn by flow.c) |
| `ambient` | a looping environment sound: wind, howling, waterfall, water, drone, birds, boos, bubbles, sand |
| `deathY`, `fallTo` | falling below a height warps like falling off; `fallTo` (a destination) makes it lead to another area instead of costing a life |
| `camera: { mode, x, y, z, axis, dist }` | default, open, radial, close (indoors), 8dir, behind, slide, boss, fixed (from a point), side (side-scroller along `axis`°), top (top-down) |

The World tab previews sliders live and saves on release.

## Claude's tools

`world_overview`, `add_area` (template, optional door pair), `go_to_area`, `add_warp` (door,
pipe, painting, zone, arrival, exit, cannon, key; `to`, stars, key, locked, style, picture),
`link_warp`, `modify_warp`, `add_hazard_zone` (death, camera, water, gas, lava, quicksand),
`set_environment`, `set_hub` (start, hub, star goal), `lock_door`. Destinations take a level
name/id or original level, an area index or name, a warp uid, a position, or the hub.

## Engine notes

- `studio_flow_area_load()` resets zones, locks, fog, tint, death height, camera, weather and
  boxes on every area load; the page re-applies the area's settings.
- Door locks are checked in `interact_door`, `interact_warp_door` and `interact_warp`
  (`studio_door_check`); paintings and warp zones check the same table.
- Messages borrow the dialog slot of `DIALOG_022` and give it back when the box closes;
  `studio_show_message(text)` waits until Mario stands still.
- The studio level's geo still has one envfx node per area; weather replaces its function with
  `geo_studio_envfx`, which draws rain/leaves/bubbles or calls the original.
- `studio_play_camera` (called from `update_graph_node_camera`) drives side and top cameras and
  sets the camera yaw so the stick follows the view.
- Debug/tests: `studio_zones_json()`, `studio_env_regions_json()`.
