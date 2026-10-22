# Roads and nature

Lay roads, walks and fences with a few clicks, and paint trees, flowers, grass, rocks and
mushrooms with a brush. Two tabs in build mode do it: **Roads** and **Nature**. Everything is
saved in the project, works in every level (your own and the original ones), comes back after a
reload, is in the project file and in the playable game, and every change can be undone.

![Roads and nature](img/roads.png)

- [Roads and walks](#roads-and-walks)
- [Changing a road](#changing-a-road)
- [Junctions and crossings](#junctions-and-crossings)
- [Fences, walls, lamps and more](#fences-walls-lamps-and-more)
- [The Nature brush](#the-nature-brush)
- [Collision, ground and performance](#collision-ground-and-performance)
- [With the AI](#with-the-ai)
- [How it works](#how-it-works)

## Roads and walks

Press `Tab` for build mode and open the **Roads** tab. Pick a style, then click points on the
ground: the road follows them in a smooth curve. **Double-click** or `Enter` finishes it;
`Backspace` takes the last point back; clicking the first point again closes a **loop**. You keep
drawing the same style until you press `Esc`, so a street grid is quick.

| Style | |
|---|---|
| **Asphalt road** | Dark asphalt with lane markings (one, two or four lanes; white or yellow centre line) |
| **Street with sidewalks** | Asphalt with raised sidewalks and curbs on both sides |
| **Sidewalk** | A raised walk of concrete tiles with curbs |
| **Dirt path** | The game's dirt, with soft edges that fade into the grass |
| **Cobblestone** | The game's cobblestones with a stone border |
| **Gravel path** | Gravel with soft edges |
| **Wooden boardwalk** | Planks on posts, raised over the ground (add railings on its sides) |
| **Stone path** | The game's stone slabs |
| *your materials* | Every custom material from **Assets › Materials** is a path style too |

The **Width** slider sets the width of the next road. Roads and walks:

- **follow the ground**: in the original levels they lie on the level's floor (and on blocks and
  imported models); in your own levels the terrain is **cut and filled** under them, with a soft
  shoulder, so they never float or sink (the saved terrain stays as it was: delete the road and
  the ground comes back);
- get **steps on steep parts** (walks; roads get a grippy ramp instead). Steps are drawn as real
  stairs and Mario walks up them like the game's own stairs;
- have **edges** that look like SM64: darker borders (baked "ambient occlusion"), embankments where
  the ground drops away, round or square ends.

## Changing a road

Click a road (with any tab, in plain select mode) and the Roads tab shows it:

| | |
|---|---|
| Drag a point | Bend the road (its ends snap onto other roads) |
| Drag the middle line | Add a point there |
| Select a point, `Del` | Remove the point (with no point selected: the whole road) |
| **Width at this point** | A wider or narrower road at the selected point |
| **Style**, **Width** | Change them at any time |
| **Smooth curve**, **Closed loop**, **Steps on steep parts**, **Follow the ground**, **Shape the terrain** | Switches |
| **Lanes**, **Centre line**, **Ends** | Markings and the road's ends |
| **Left side** / **Right side** | A fence, railing, wall, hedge, kerb, bollards, lamps or posts along that side |
| **Fit to ground** | Lay it on the ground again (after you sculpted the level under it) |
| `Esc` | Done |

The **In this area** list shows every road and fence of the area; click one to select it and
fly there, the bin deletes it.

## Junctions and crossings

Start or end a road **on another road** (a blue ring shows the snap) and they join: the new road
eases to the other one's height and runs under it, and the other road opens there: its centre
line, edge line, curb and sidewalk, and any fence or lamps on that side, leave a gap. Two roads that
simply **cross** both lose their markings and curbs in the crossing; if they are far apart in
height (a bridge over a road) nothing changes.

## Fences, walls, lamps and more

Under **Fences, walls & lamps** in the Roads tab, pick a style and click the corners of the line
(double-click finishes; turn on **Smooth curve** in its panel for a round fence):

| Style | Collision |
|---|---|
| Picket fence, rustic fence, castle iron fence, chain-link fence, bamboo fence | Blocks Mario (he can jump over the low ones) |
| Railing, guard rail | Blocks Mario |
| Low stone wall, hedge, kerb | Solid: Mario can stand on them |
| Bollards, street lamps, wooden posts | Posts at intervals; Mario walks between them |

Select a fence and click a **section** (between two points) to make it a **gap** or a **gate**
(two open gate leaves). **Height** scales it. Fences along a road are set in the road's panel
(**Left side**, **Right side**) instead: they follow the road and open at its junctions by
themselves.

## The Nature brush

Open the **Nature** tab and hold the left mouse button over the ground: the brush plants what is
selected in **What to plant**. `Shift` + drag erases (all kinds, or only the selected ones with
*Eraser: only these kinds*). `[` `]` or `Alt` + wheel change the brush size. Each stroke is one
edit (`Ctrl+Z`).

| Group | Kinds |
|---|---|
| Trees | Round tree, pine, palm, cherry blossom, autumn tree, dead tree: low-poly models in SM64's style |
| Game trees | The game's own bubbly tree, pine, snowy pine and palm: real objects, **Mario can climb them** |
| Bushes | Bush, berry bush, flowering bush, round shrub |
| Flowers | Tulips (red, yellow, pink, purple), daisies (white, yellow), sunflowers, roses (red, white, pink), bluebells, poppies |
| Grass | Grass tufts, tall grass, ferns, reeds |
| Rocks & mushrooms | Small rocks, boulders (solid), red and brown mushrooms, giant mushrooms (Mario can stand on the cap) |
| Water | Lily pads (only on water) |

Click a kind to add or remove it, `Shift`+click to plant only that one. **Presets** fill the
palette: Meadow, Forest, Flower bed, Jungle, Autumn, Pond edge.

| Brush setting | |
|---|---|
| Brush size, Density | How big, how full |
| Size variation | How much the plants differ in size |
| Random rotation, Lean with the slope | Flowers, grass and rocks tilt with the ground; trees stay upright |
| Keep off roads, Keep out of water | On by default (lily pads always go on water, reeds may stand in it) |

Each kind keeps its own spacing: trees do not grow into each other, grass may grow under them.
Trees do not grow on cliffs. **In this area** shows how many plants and triangles the area has,
and *Remove all plants here* clears it (undoable).

## Collision, ground and performance

- Roads have real collision with a fitting surface: paved styles are **grippy** (Mario does not slide
  on steep roads), dirt and gravel are normal ground. Curbs, sidewalk edges and walls are walls;
  fences are thin solid slabs.
- Tree trunks, boulders and giant mushrooms are solid; flowers and grass are not.
- Plants are batched: every 2048×2048 piece of the area is one model for small plants and one for
  big ones, so thousands of plants cost a handful of objects. Small plants are not drawn further
  than about 5,000 units away. Above 60,000 plant triangles in one area the brush stops and says
  so (the game would slow down).
- Each road and fence is one model. Models share the 256 model slots with imported models (only the
  current area's are loaded).

## With the AI

When an AI is connected it has the same tools: `draw_road` (style, points or "ahead of Mario",
width, loop, lanes, sides), `edit_road`, `add_fence` (through points or along a road's side, gaps
and gates), `paint_nature` (a preset or kinds, a circle or along a road, density, erase) and
`list_paths`, `remove_path`. "Make a cobblestone path from Mario to the castle with lamps on the
left", "plant a forest around the lake", "put a picket fence around the garden with a gate".

## How it works

Code: `web/js/paths/` — `runtime.js` (game side, also in the player), `roads.js` (styles, ground
fitting, the junction network, road meshes, terrain cut and fill), `lines.js` (fences and the
rest), `nature.js` (kinds, presets, plant models), `mesh.js` (mesh builder and shapes),
`textures.js` (the game's own textures plus small N64-style ones), `geom.js` (curves),
`ops.js` (the edits), `ui.js` (the tabs), `rpc.js` (the AI's browser side); AI tools in
`server/tools/paths.js`; styles in `web/css/paths.css`.

- **Records.** Each road, line and painted stroke is an ordinary record in the area's `objects`:
  `{ uid, name, road: { style, width, pts: [[x, y, z, width?], ...], closed, smooth, lanes, left, right, prof, drop, ... } }`,
  `{ uid, name, line: { style, pts, gaps, gates, scale, prof } }`,
  `{ uid, name: 'Plants', nature: { items: [[kind, x, y, z, yawDeg, scalePct, nx100, nz100], ...] } }`.
  So undo, the edit list, other tabs, versions, the project file and the playable game need no
  extra code. `prof`/`drop` are the ground heights along the road sampled when it was last edited
  (with the roads' own collision switched off), so it is rebuilt identically on every load.
- **Engine.** No C of its own: meshes go into the model slots of `src/studio/assets.c`
  (`studio_model_begin/material/tris/collision/end`) and are placed with `studio_model_spawn` as
  props with static collision. Their engine objects use uids `0x7e400000`+; `engine.objects()`
  leaves them out and `engine.raycast()` reports their surfaces as level ground (with
  `hit.paths` naming the road), so other tools build on roads like on any floor.
- **Terrain.** In custom levels `World.loadTerrain` and `syncTerrain` are wrapped: after the
  heightmap is in the engine, the roads cut and fill it (`carveTerrain`); the saved heightmap is
  untouched.
- **Junctions.** `prepareNetwork` finds road ends on other roads and crossings, then sets gap ranges
  (markings, curbs, side lines), heights and lifts (the joining road 2 units under) for each road;
  a road's mesh is rebuilt only when its record or its junctions changed.

Tests: `tests/suite/paths.test.mjs` (`node tests/run.mjs paths`) draws a road and a fence with the
mouse, walks Mario along the road, up the steps of a walk and into the fence, edits points and
width, paints and erases a forest, undoes, reloads, opens the player and the playable export.
