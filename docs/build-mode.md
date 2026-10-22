# Build mode

Build mode is the mouse editor. Press `Tab` (or **Build** in the rail) and the world pauses, the
camera works like in a 3D modelling program, and everything in the level can be clicked, moved,
changed and deleted. Press `Tab` again to play.

![Build mode](img/no-ai.png)

- [The camera](#the-camera)
- [The library](#the-library)
- [Selecting and changing things](#selecting-and-changing-things)
- [The inspector](#the-inspector)
- [The build bar](#the-build-bar)
- [Original level objects](#original-level-objects)
- [Saving and undo](#saving-and-undo)

## The camera

| Do this | To |
|---|---|
| Right-drag or middle-drag | Orbit around whatever is under the mouse |
| `Shift` + drag | Pan |
| Wheel, or `Ctrl` + drag, or pinch | Zoom toward the mouse |
| `Alt` + left / middle / right drag | Orbit / pan / zoom, like Maya |
| Double-click | Center on that spot |
| `F` | Frame the selection |
| `Home` / `Shift+Home` | Frame Mario / the whole level from above |
| Numpad `1` `3` `7` | Front / right / top view (with `Ctrl`: the opposite side) |
| Numpad `2` `4` `6` `8` | Orbit in 15° steps |
| Hold right mouse + `W` `A` `S` `D` `Q` `E` | Fly like in a game editor (`Shift` is faster) |

The **axis widget** in the top right corner of the game does the same with the mouse: drag it to
orbit, click X, Y or Z for side and top views, and use its pan, zoom and frame buttons.

## The library

The panel on the left has one tab per kind of thing you can add:

| Tab | What you get |
|---|---|
| **Blocks** | Boxes, platforms, ledges, walls, big floors, ramps, stairs and pillars with real collision, in 29 game materials (grass, bricks, wood, ice, lava, ...) and any tint. Pick one, then click in the level. Clicking a wall attaches the block to it, so you can build up a cliff. |
| **Objects** | Every object of the game, about 600, with pictures: search, or browse by category (Popular, Sunshine, Enemies, Items, Bosses, Friends, Mechanics, Decoration). **My objects** holds your custom objects and prefabs. |
| **Builds** | Generators: staircase, spiral staircase, wall climb, bridge, floating platforms, tower. Click where it goes, tune it (a live preview shows it), then press **Build**. |
| **Models** | Your imported 3D models. See [Assets](assets.md). |
| **Roads** | Roads, streets, sidewalks and paths through points you click, fences, walls, hedges and lamps along lines. See [Roads and nature](roads-and-nature.md). |
| **Nature** | A brush that plants trees, flowers, grass, rocks and mushrooms. See [Roads and nature](roads-and-nature.md#the-nature-brush). |
| **Terrain** | Sculpt and paint brushes, level settings (sky, music). See [Levels and terrain](levels-and-terrain.md). |
| **World** | Areas, doors, warps, paintings, zones and the level's environment. See [World](world.md). |
| **Logic** | Characters, zones and events for the story. See [Story](story.md). |

While placing, every click adds one more. `R` or `Shift`+wheel turns what you are placing;
right-click or `Esc` stops.

## Selecting and changing things

Click anything to select it: a block, an object, a star, a warp. Then:

| Do this | To |
|---|---|
| Drag it | Slide it over the ground (`Shift`: up and down) |
| `1` | Move handles (axis arrows) |
| `2` | Rotate handles (rings) |
| `3` | Resize handles (block faces) or scale |
| `R` | Turn 45° |
| `G` | Drop it to the ground |
| `Ctrl+D` | Duplicate |
| `Del` | Delete |
| `Ctrl+C` / `Ctrl+V` | Copy and paste, also into another level |
| `Alt` while dragging | Ignore the grid |

**Several at once:** `Shift`- or `Ctrl`-click adds to the selection, dragging on empty space
draws a selection box, and `Ctrl+A` selects everything you built. Moving, turning, duplicating
or deleting then works on all of them.

**The scene panel** (`O`, or the layers button) lists everything in the level: search it, hide
or lock things, rename them, align and distribute a selection, and save a group as a **prefab**
to place again anywhere. Details: [Objects](objects.md#scene-panel-multi-select-prefabs).

## The inspector

When something is selected, the inspector replaces the library on the left:

- **Position, rotation and size** as numbers.
- For blocks: **shape** (box, ramp, stairs, pillar), **material** and **tint**, and **collision**:
  the surface (normal, grippy, slippery, ice, lava, hangable ceiling, hard, death floor,
  vanish-cap wall), *Invisible* and *No collision*.
- For objects: friendly choices where they matter (which star, what is in a `!` box, a Goomba's
  size, a coin formation's shape, ...) and the raw **behavior params** (`bparams`, see the
  [glossary](glossary.md#objects)).
- **Motion**: make it move along a path, spin, swing, tilt, fall, crumble, blink, carry Mario or
  bounce him. See [Objects: motion](objects.md#motion-moving-platforms-and-more).
- **Make it talk**: any Toad, sign or character can say one of your dialogs. See [Story](story.md).
- For doors, pipes and warps: where they lead (**Link…**) and what they need (stars, a key).
  See [World](world.md#warps).

## The build bar

The bar floating over the game:

| Button | |
|---|---|
| Move / rotate / resize | The handle mode (`1` `2` `3`) |
| Grid | Snap step: off, 25, 50 (default), 100, 200 units |
| Undo / redo | `Ctrl+Z` / `Ctrl+Shift+Z` |
| Layers | The scene panel (`O`) |
| `?` | A card with all build controls |
| **Play from here** | Leave build mode with Mario on the ground where the camera looks. `P` does the same at the spot under the mouse. |

## Original level objects

The objects the level already has (Goombas, trees, coins, ...) can be selected, moved, changed or
deleted too. Studio 64 then removes the original and spawns a saved copy in its place, so the
change comes back every time the level loads. A few original objects can only be deleted, not
changed; the editor tells you when.

## Saving and undo

There is no save button. Every edit goes to the server right away and comes back whenever the
level loads: after a reload, a death, or a trip to another level.

- `Ctrl+Z` undoes the newest edit of the level you are in, or of the whole project (a story,
  asset or sound edit), whichever came last; `Ctrl+Shift+Z` (or `Ctrl+Y`) redoes.
- The **Edits** tab in the side column lists every change of the project, each with its own
  undo button.
- **Version history** in the ⋯ menu restores the whole hack to an earlier point.
  See [Projects](projects.md#version-history).
