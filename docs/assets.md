# Assets: models, textures, materials, skies and Mario

The **Assets** button (left rail / top bar) opens the asset drawer next to the game. Everything in it
is stored in the project and comes back on every load, for everyone on the project link.

## 3D models

**Import:** drop `.glb`, `.gltf` (+ `.bin` + textures), `.obj` (+ `.mtl` + textures), binary `.fbx`
(embedded or dropped textures) or a `.zip` of any of these anywhere on the page, or use *Import a 3D
model* in the drawer or in build mode's **Models** library tab. The import dialog shows the model
as the game will draw it (converted textures, vertex colours, the game's shading) with a grid and
a red Mario-sized box for scale:

- **Use as**: *Prop* (placed many times, optional collision and animation) or *Level geometry*
  (full-mesh collision, any size, not clickable in build mode so you can't drag the level by
  accident).
- **Size**: scale factor, or type a height in game units (Mario is 160 tall; buttons for Mario,
  house and hill sizes). glTF is read as meters (×100), FBX in its own unit scale, OBJ guessed.
- **Orientation**: Y-up / Z-up (Blender, 3ds Max), 90° turns per axis, origin at the bottom center
  (stands on the ground), center or as in the file.
- **Textures**: maximum size (32–512; 64 is N64-like) and format (RGBA16, RGBA32, CI8, CI4, IA8,
  I4: the image is quantized to that look). Sizes become powers of two.
- **Light**: shaded like the game (baked from the normals) or flat (vertex colours only).
- **Materials**: per material the **surface** (normal, grippy, slippery, ice, lava, death floor,
  hangable ceiling, hard, noisy, quicksand, shallow sand, vanish-cap wall, *water*: swimmable, no
  collision, or *no collision*), **transparency** (solid, cut-out for leaves and fences,
  see-through), **2-sided**, and texture **wrap** (repeat, mirror, clamp) per direction. Surfaces are
  guessed from material names ("lava", "water", "ice", "leaves" ...).

*Save to My models* stores it; *Save & place* starts placing right away. In build mode's **Models**
tab click a model, then click in the level as often as you like (R turns it). The **⋯** menu:
place as prop, place as level geometry, **new level from this model** (a custom level made of it,
Mario dropping in above its middle, an invisible death floor below), settings, rename, delete
(also removes its placements).

Placed models are ordinary edits: move, rotate (also tilt/roll), scale, duplicate, delete and undo
work like for any object. The inspector shows the model with **Use** (prop / level geometry),
**Solid**, **Animation** (still, spin, float up and down, spin and float, sway, pulse) and **Speed**.
Mario rides spinning and floating props.

Limits: 120,000 triangles per model (warning above 20,000), 64 materials, coordinates within
±32,000 units; collision only works within ±16,384 units of the level center (the collision grid: Studio 64's
engine doubles the original game's ±8,192) and imported collision shares the level's surface pool (about 57,000 triangles; a toast says
when some triangles are left without collision). Moving (animated) props collide with their mesh if
it has at most 200 distinct vertices, otherwise with their bounding box. Skinned meshes import in
their rest pose; Draco/meshopt-compressed glTF and ASCII FBX are not supported.

Changing a model's settings rebuilds it in the engine; the old buffers are freed as soon as nothing
draws them any more (deleting a model frees it and its slot), so importing and re-importing does not
grow the memory (`studio_assets_mem()` counts it). The area's light (World tab → Light: sun
direction, colour, ambient) shades imported models and blocks as well as the terrain; models set
to *flat* light keep their colours.

## Game textures

The **Textures** tab lists all ~1,200 textures of the game (levels, objects, Mario, HUD, effects),
searchable, by group, and "In this level" (what the renderer drew since the level loaded). Pick one
to:

- **Replace with image**: scaled to the texture's size and N64 colours, or kept up to 4× sharper.
- **Edit pixels**: the pixel editor (pencil, eraser, fill, line, picker, mirror drawing, an N64
  palette, recent colours, undo/redo, flips, 90° turn, N64 sizes 8–128, N64 format quantization,
  a tiled preview).
- **Recolour**: hue, saturation, brightness, contrast, tint.
- **Use on blocks**: copies it into a custom material.
- **Original** puts the game's texture back.

A replacement shows everywhere the game uses that texture (all levels).

## Materials for blocks and terrain

The **Materials** tab holds up to 16 custom materials (material numbers 48–63): from an image, drawn
in the pixel editor, from a pattern (bricks, tiles, wood, grass, stone, noise, checker, stripes,
dots, gradient, solid; two colours, scale) or from any game texture. They appear at the end of
the material lists of blocks, the inspector and the terrain paint brush. 64×64 materials can be
drawn *sharp* (the block keeps a 32×32 N64 copy).

## Skies

The **Sky** tab sets this level's sky or one for all levels (a level's own wins): from a 360°
panorama (2:1 equirectangular) or any picture (mirrored around, horizon slider), in N64 quality
(32-pixel tiles) or sharp (64-pixel tiles), or **made** from colours: a top/horizon/bottom gradient,
clouds, stars, sun and mountain silhouettes, with presets (sunny day, sunset, night, storm, lava,
candy, space). Skies show in levels with a skybox (outdoor levels and custom levels).

## Mario

The **Mario** tab colours overalls, shirt & arms, gloves, shoes, skin, hair and cap (the cap is
split from the shirt), with presets (Luigi, Wario, Waluigi, Fire, Ice, Classic NES, Gold, Shadow,
Builder, Doctor, Pink). *Look at Mario* turns the camera around him while you choose.

## Claude

Claude's tools (server/tools/assets.js): `list_assets`, `place_model` (where like `spawn`, prop or
level, scale, animation), `search_textures`, `edit_textures` (recolour, generated patterns, reset;
by paths or a query, optionally only what is drawn in this level), `set_skybox` (generated from
colours, clouds, sun, stars, mountains), `clear_skybox`, `set_mario_colors` (preset and/or parts).
"Put five of my crates around me", "make Mario look like Wario", "give this level a night sky",
"make all the grass in this level blue".

## How it works

- **Store** (server/assets.js, routes/assets.js): files in `projects.assetDir(id)/files/` (32 MB per
  file, 400 MB per project): `GET/PATCH /api/projects/:id/assets` (metadata in `project.assets`:
  `models`, `textures`, `materials`, `skies`, `mario`, `files`), `POST/GET/DELETE
  /api/projects/:id/assets/files[/:file]`. A PATCH is broadcast as `{ type: 'assets' }`.
- **Import** (web/js/asset_import.js): OBJ/MTL, glTF/GLB (accessors, node hierarchy, samplers,
  vertex colours, embedded or external images), binary FBX (zlib arrays via DecompressionStream,
  layer elements, materials, textures and embedded videos, model hierarchy, up axis and unit), zip
  archives, TGA. **Package** (web/js/asset_mesh.js): game-unit triangles with uvs, colours and
  normals plus converted PNG textures in one `.s64m` file.
- **Engine** (engine/src/studio/assets.c, studio_assets.h): `studio_model_begin/material/tris/
  collision/end` build per-model display lists in three layers (opaque, cut-out, translucent; vertex
  batches of 30 with per-triangle uv shifting for the s10.5 range), a culling node and the moving-
  prop collision. `bhvStudioModel` objects are the placements; `studio_assets_add_surfaces` adds
  placed models to the static collision in every rebuild (world.c), tagging prop surfaces with
  their object so editor clicks select them. Water materials become environment-region boxes.
- **Texture overrides**: gfx_pc.c asks `studio_texture_override(addr)` for every texture it
  imports; a hit uploads that RGBA32 image (any size) instead. Imported models, sharp materials and
  skies use the same path. `gfx_texture_cache_flush` makes changes visible. Game textures are found
  in memory by fingerprints from `tools/gen_textures.py` (web/data/textures.json: format, size, two
  probe windows, FNV hash of the raw bytes from the engine build); rerun it after rebuilding the
  engine from a different ROM.
- **Skies**: the 8×8 tiles of 32×32 RGBA16 replace the pointer lists of every skybox while a custom
  sky is on (`studio_sky_buffer/apply`).
- **Mario**: the light groups of his display lists are found by walking them; the cap's head and
  hand lists are re-pointed to the cap object's own red, the hands to a glove copy of white
  (`studio_mario_color(part, rgb, shade)`).
- **For other features**: `studio64.assets.ensureModel(id)` loads a model and gives its engine
  model number; in C `studio_asset_model_node(n)` is its graph node and
  `studio_asset_model_collision(n)` its object collision, e.g. for custom enemies.

Tests: `tests/suite/assets.test.mjs` (`node tests/run.mjs assets`; fixtures in tests/fixtures, made by make_fixtures.py: an OBJ platform
with a lava pool, a GLB crate, a Z-up FBX house, a panorama).
