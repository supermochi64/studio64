# Objects, motion, custom objects and game rules

Everything that moves, fights or changes how the game plays. All of it is saved in the project
and re-applied whenever a level loads. Everything works with the mouse and keyboard alone (no AI
needed); Claude's tools are an extra way to do the same things.

## Motion (moving platforms and more)

Select a block or an object in build mode. The inspector's **Motion** section has one chip per
kind of motion; click one to add it (click again to remove it). Motions combine: a platform can
follow a path *and* spin.

| Motion | What it does | Settings |
|---|---|---|
| **Path** | moves along points you draw | speed, back & forth / loop / once, wait at points, smooth curve, faces where it goes, starts: always, when Mario stands on it, *while* he stands on it (elevator: it goes back when he leaves), when he comes near, when an event starts it |
| **Rotate** | spins around yaw / pitch / roll | degrees per second per axis (a wheel is roll) |
| **Swing** | pendulum | sideways / front-back / turn, angle, period, hangs from (a pivot above makes it swing on an arc) |
| **Seesaw** | tilts toward where Mario stands | max tilt, speed |
| **Falls** | shakes, then falls when Mario stands on it | delay, comes back after |
| **Crumbles** | breaks apart under Mario | delay, comes back after |
| **Blinks** | disappears and comes back on a timer (flickers before it goes) | visible, gone, offset (to stagger copies) |
| **Conveyor** | carries Mario along its top | speed, direction (relative to the block) |
| **Trampoline** | throws Mario up (higher after a ground pound) | power |
| **Sinks** | sinks while Mario stands on it | depth |

*Quick* presets: moving platform, elevator, loop, spinner, wheel, falling, blinking.

Mario rides all of them: a moving object reports its movement each frame in `oVel*` /
`oAngleVel*`, which is what the game's own platform displacement uses, and its collision
moves with it (blocks load their collision after the motion step). In build mode everything
waits at its home pose; moving the object in the editor moves its path along.

### The path tool

**Edit path** (or adding the Path chip) turns the mouse into the path tool:

- **click** adds a point at the end, level with the last point (Ctrl+click: on the ground);
  clicking on a segment inserts a point there
- **drag** a point to move it, **Shift+drag** moves it up and down
- **right-click** a point deletes it, **Delete** deletes the hovered (or last) point
- **Enter** / **Esc** ends the tool

Point 0 is the object itself (green). Every edit is one undo step. The *Points* list in the
card gives exact offsets (handy for elevator heights). A white dot runs along every path at
its speed, so you see the timing without playing; other paths in the area are drawn faintly.

### Original platforms and props

Catalog platforms with their own collision (checkerboard platforms, wooden platforms, ...)
become **movers** when they get a motion: the same model and collision, moved by the motion
instead of their original behavior (`bhvStudioMover`). Imported models (assets) do the same:
an imported prop with a motion is a mover with the model's collision. Other objects (enemies,
decoration) keep their behavior and follow the motion on top of it.

### The game's own path objects

Koopa the Quick (Bob-omb Battlefield, Tiny-Huge Island), the racing penguin, platforms on tracks
(Rainbow Ride, Bowser courses, ...) and a few swimmers follow paths from the level data. Select
one: the inspector shows **Race path** / **Track** with **Edit path** (the same tool, points
in level coordinates) and **Original path**. Saved per area as `paths`; platforms on tracks (the
project's and the level's own) start over on the new track at once (and on their own one after
**Original path**); a path that did not change keeps whatever rides it undisturbed.

## Custom objects (enemies and characters without code)

**Objects → My objects → New custom object** opens the builder:

- **Model**: any of the ~600 catalog models (or an imported model); its own animation is used.
- **Start from**: Walker, Chaser, Guard, Turret, Ghost, Spiky, Boss, Hopper.
- **Movement**: stands, wanders (within *stays within*), patrols a path, chases Mario (when it
  *sees Mario from* that far; returns home beyond its range), turret; speed, chase speed,
  turning, flies (with bobbing), looks at Mario.
- **Jumping**: never, hops (every N s), at Mario, over walls; jump power.
- **Attack**: contact damage (0 = harmless, only pushes), shoots at Mario: fireball, blue
  flame, iron ball, spiny egg, water bomb, bubble, egg, coin; rate, speed, damage, arc, size,
  burns.
- **Defeat**: stomp / punch & kick / invincible, hits to defeat (knocked back and blinking in
  between), goes away with a poof, squish, explosion, flying off or shrinking, coins (yellow or
  blue), comes back after N seconds (or never).
- **Sounds**: when it sees Mario, gets hit, is defeated, attacks (any game sound, with preview).
- **Size**: scale, hitbox (auto by default), animation index.

**Save & place** puts it in the level right away (ghost under the mouse, R turns, Shift+click
places more). Definitions live in the project (`@game.objdefs`); copies are records
`{ bhv: 'bhvStudioActor', model, def, actor }`, so editing a definition changes every copy in every
level. `actor` is a snapshot of the definition when the copy was placed: a copy whose definition is
gone (its creation undone) keeps that behaviour. A patrolling copy gets its route from **Patrol
path** in the inspector.

## Scene panel, multi-select, prefabs

**O** (or the layers button in the build bar) opens the **scene panel**: everything in the level
grouped into blocks, custom objects, placed objects and the level's own objects, with search
and filters (blocks, placed, moving, enemies, original).

- Click selects, **Shift/Ctrl+click** adds to the selection (in the panel or in the level),
  a **drag on empty space** in the level draws a selection box, **Ctrl+A** selects everything
  you built.
- With several selected, moving or turning the selected one with the gizmo, the inspector or R
  moves/turns them all; **Delete**, **Ctrl+D** and **G** work on all of them.
- Group tools: align X / Z (min, center, max), bottoms / tops, even spacing on X / Z / Y, drop
  to the ground, snap to the grid. Each is one undo step.
- Per row: **hide** while building (eye), **lock** (can't be picked or moved), double-click the
  name (or F2) to rename.
- **Ctrl+C / Ctrl+V** copy and paste, also between levels (and projects in the same browser).
- **Save as prefab** keeps the selection in **My objects**; click it there to place it again
  anywhere (R turns the whole group).

## Game rules

The **Game** button (or **P**) opens the rules, for the **whole game** or just **this level**
(level rules override the game's; overridden fields are marked, ↺ resets one):

- **Mario**: run speed, gravity, air control, swim speed, fall damage height (0 = none).
- **Jumps**: height of jump, double, triple, backflip, side flip, long jump, wall kick; long
  jump distance.
- **Moves**: switch off the long jump, backflip, side flip, triple / double jump, wall kick,
  ground pound, dive, slide kick, punch & kick, ledge grab, crouch; no BLJ speed.
- **Health & lives**: damage taken (0 = invincible), one hit kills, infinite lives, starting lives.
- **Coins & caps**: 1-up every N coins, coins refill health, 100-coin star, wing / metal /
  vanish cap time.
- **HUD & timer**: hide lives, coins, stars, power meter, keys; a level timer; a time limit.
- **Items**: Mario starts with the [shotgun](shotgun.md) or the [katana](katana.md) (one weapon at a time).
- **Presets**: classic, moon, speedy, hardcore, kids, pure platformer, Shotgun Mario, Katana Mario.

Stored as `@game.rules = { base, levels: { "<level number>" | "c:<custom id>": {...} } }`.
The engine side is `gStudioRules` (src/studio/rules.c), read where the game does those
things (jumps in `set_mario_action_airborne`, gravity in `apply_gravity`, moves in
`set_mario_action`, ...).

## Claude's tools (server/tools/objects.js)

`list_scene`, `attach_motion`, `set_object_path` / `get_object_path`, `trigger_motion`,
`create_custom_object` / `edit_custom_object` / `place_custom_object` / `list_custom_objects`,
`make_prefab`, `arrange_objects` (align, distribute, drop, move, rotate as one undo step),
`set_game_rules` / `get_game_rules`. Examples: "make this platform go up and down when I stand
on it", "add 3 koopas that chase me and take 3 hits", "moon gravity in this level only",
"no long jumps in the whole game", "line these blocks up and save them as a prefab".

## For other features (events, story)

Every placed thing has a `uid` (`studio64.objects.store.recordOf(uid)`). `window.studio64Objects`:

```js
studio64Objects.on(({ uid, event, record }) => {});  // custom objects: 'spotted', 'hit', 'hurt_mario', 'defeated'
studio64Objects.trigger(uid);                         // start a motion whose trigger is "event"
studio64Objects.setMotion(uid, { path: {...} });      // change a motion live (not saved)
studio64Objects.spawnDef(defIdOrName, [x, y, z]);    // a copy of a custom object (not saved)
studio64Objects.rules();                              // the rules in effect here
```

The same events arrive as `window` `studio:object` events. Engine exports:
`studio_motion_set/clear/trigger/state_json`, `studio_path_override_add/clear`,
`studio_path_info_json`, `studio_actor_set`, `studio_actor_state_json`, `studio_mover_setup`,
`studio_object_asset_model`, `studio_catalog_info_json`, `studio_rules_set`,
`studio_rules_json`, `studio_set_lives`, `studio_set_visible`.

## Files

- `engine/src/studio/motion.c` motions, paths of path objects; `actor.c` custom objects,
  projectiles, movers; `rules.c` game rules; `objects.h` the hooks. Hooks in mario.c,
  mario_step.c, mario_actions_*.c, interaction.c, hud.c, behavior_script.c,
  object_helpers.c, obj_behaviors_2.c (platform_on_track), editor.c, studio.c.
- `web/js/objects/`: `index.js` (wiring, rpc for the tools), `motion.js` (inspector section,
  path tool), `actors.js` (builder), `scene.js` (scene panel, groups, prefabs, clipboard),
  `placer.js` (placing groups), `game_rules.js` (Game panel), `common.js`; `web/css/objects.css`.
- Tests: `tests/suite/motion.test.mjs` (riding every motion), `custom_objects.test.mjs`
  (builder, getting hurt, stomping, shooting, patrol, edits, reload), `game_rules.test.mjs`
  (measured jump heights, run speed, gravity, fall damage, long jump off, overrides, reload),
  `objects_ui.test.mjs` (path tool, scene panel, multi-select, align, prefabs, copy/paste,
  undo, hide/lock/rename), `objects_ai.test.mjs` (every tool against the real game).
