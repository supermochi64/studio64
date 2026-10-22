# Glossary

Words from Super Mario 64, its decompilation and Studio 64, in plain language.

**Jump to:** [Game](#the-game) · [Levels and areas](#levels-and-areas) · [Objects](#objects) ·
[Warps](#warps) · [Collision](#collision) · [Story](#story) · [Sound](#sound) ·
[Studio 64](#studio-64) · [Technical](#technical)

## The game

- **Star**: What Mario collects. Each course has 7: six act stars and the 100-coin star.
- **Act**: One of a course's six missions. The **star screen** (act selector) lets you pick one before
  entering; some objects only appear in certain acts. Your own levels list your stars there.
- **100-coin star**: The 7th star of a course: it appears when Mario holds 100 coins. Your own levels have one too.
- **Red coin star**: A star that appears once Mario collects the level's 8 red coins.
- **Course**: One of the game's 15 main levels behind the castle paintings (Bob-omb Battlefield, Whomp's
  Fortress, ...). Courses have acts, a pause menu with *Exit Course*, and a course complete screen.
- **Castle**: The hub of the original game: castle grounds, inside the castle, the courtyard. In your own
  hack you can choose a different [hub](world.md#hub-and-flow-patchworld).
- **Cap**: Wing, Metal and Vanish caps change Mario's powers for a while; the cap switches unlock them.
- **Lakitu camera**: The game's normal camera (the cameraman on a cloud). `R` switches its mode.
- **Save file**: The game's own save (stars per course, keys, opened doors, caps). There are four;
  Studio 64 keeps a separate set per project. The
  [play-test tools](testing-tools.md#save-file) can edit it.
- **BLJ**: Backwards long jump, a famous speed glitch. Game rules can turn it off ("no BLJ speed").

## Levels and areas

- **Level**: One of the game's places (a course, the castle, a Bowser stage, a secret level), or one of
  your own. Each level has a number in the engine (Bob-omb Battlefield is 9).
- **Area**: A part of a level that loads on its own: the inside of a building, a cave, the second half of
  a stage. A level has up to 8 areas in the game; your own levels can have up to 7. Moving
  between areas is a [warp](#warps).
- **Custom level** (your level): A level you made in Studio 64. All custom levels share one empty level slot of the engine
  (`LEVEL_STUDIO`, number 37); Studio 64 fills it with the right level's terrain and objects when
  it loads. Their patch keys look like `c:<id>` (area 1) and `c:<id>:<n>` (other areas).
- **Template**: A ready-made starting point for a new level (island, meadow, mountain, ...).
- **Terrain**: The ground of a custom level: a heightmap (a grid of heights, 64×64 cells of 128 units) painted
  with materials. **Sculpting** is the same brushes on an original level's real ground.
- **Skybox**: The picture far away behind everything. The game has ten; you can make your own in
  [Assets](assets.md#skies).
- **Unit**: The game's distance unit. Mario is about 160 units tall. Collision works within ±16384
  units of a level's center (Studio 64's engine; the original game's grid ends at ±8192).

## Objects

- **Object**: Anything in a level that has behavior: Goombas, coins, stars, platforms, trees, signs.
- **Behavior** (`bhv...`): The code that makes an object act: `bhvGoomba`, `bhvStar`. The same model can have different
  behaviors.
- **Model**: What an object looks like (its 3D mesh). In Studio 64 every model is loaded in every level, so
  any object works anywhere.
- **bparams** (behavior parameters): A 32-bit number stored with each placed object that tells its behavior which variant to be.
  It is written as four bytes, `0xAABBCCDD`:
  byte 1 (`AA`) is often the star number of a star, byte 2 (`BB`) often the variant (what is
  inside a `!` box, a Goomba's size, the shape of a coin formation). The inspector offers friendly
  choices for the common ones and the raw value for everything else.
- **Catalog**: Studio 64's list of everything you can place: about 480 objects (every object the game places
  anywhere, plus some it only spawns from code) and about 130 **props** (static models), plus the
  Sunshine characters. Generated from the decomp by `tools/gen_catalog.py`. See
  [Adding catalog objects](adding-objects.md).
- **Prop**: A model with no behavior, placed as decoration.
- **Block**: Studio 64's building piece: a box, ramp, stairs or pillar with real collision, a material and a
  surface type.
- **Prefab**: A group of things you saved to place again anywhere (in *My objects*).
- **Custom object**: An enemy or character you build in Studio 64 from a model and behavior blocks (wander, chase,
  shoot, health, ...), without code. See [Objects](objects.md#custom-objects-enemies-and-characters-without-code).
- **Motion**: Movement you give a block or object: a path, rotation, swinging, falling, blinking, ...
- **Object pool / object slots**: The engine can only have a fixed number of objects at once (240 in the original game, 960 in
  Studio 64's build). The level check warns when a level is close. What you place stops 32 slots short
  of the limit, so the game always has room for its own coins, stars and effects; if the pool still
  runs full, new objects are left out (the game never freezes over it).

## Warps

- **Warp**: Anything that moves Mario to another place: a door, a pipe, a painting, falling off the level,
  the end of a course.
- **Warp node**: A numbered connection point of an area (0 to 255). A warp node says "Mario arriving here comes
  from that level, area and node". Doors and pipes point to warp nodes. Studio 64 gives its own
  warps nodes `0x80` to `0xDF`; the game uses `0xF0` (after a star), `0xF1` (after dying) and
  others for its own returns.
- **Warp zone**: An invisible box that warps Mario when he walks in.
- **Painting**: A picture Mario jumps into to enter a level, like the castle's course paintings.
- **Hub**: The place Mario comes back to after a star, a death or *Exit Course*. In the original game,
  the castle. See [World](world.md#hub-and-flow-patchworld).
- **Star door**: A door that needs a number of stars to open. Key doors need a key.

## Collision

- **Collision**: The invisible triangles Mario stands on and bumps into. They can differ from what you see.
- **Surface type**: What a collision triangle does: normal, slippery, ice, lava (burns), death floor, hangable
  ceiling, quicksand, water, ... The debug view (`F2`) colors them.
- **Floor / wall / ceiling**: Collision triangles by how steep they are: Mario stands on floors, is pushed by walls and
  bonks his head on ceilings.
- **Surface pool**: The engine's memory for collision triangles. Huge imported models can fill it; the level check
  warns.
- **Hitbox**: The cylinder around an object that touches Mario (to hurt him, be stomped, or be collected).

## Story

- **Dialog**: A text box the game shows (a sign, a Toad, a message). The game has 170; your own are added on top.
- **Flag / counter**: Story variables: a flag is yes or no ("gate open"), a counter a number ("coins given").
- **Event**: *When* something happens, *if* conditions hold, *then* do actions. See [Story](story.md).
- **Zone**: An invisible box that triggers events (or warps, water, camera changes) when Mario is inside.
- **Cutscene**: A scripted camera sequence with dialogs, played while Mario waits.

## Sound

- **Sequence** (`.m64`): The game's music format: notes for its sequence player, like MIDI.
- **Sound set** (sound bank): The instruments a song can use. Each of the game's songs has its set.
- **Sound effect**: A short sound (coin, jump, ...). You can replace any of the game's about 400 sounds.

## Studio 64

- **Project** (hack): Your whole mod: every edit, level, song, dialog and asset. Saved on the server.
- **Edit / record / patch**: Every change you make is an **edit** (with undo). Objects you add are **records** (behavior,
  model, position, bparams, ...); the original objects you remove are **removals**. All records
  and removals of all areas together are the project's **patch**, which Studio 64 replays every
  time an area loads. See [Architecture](architecture.md).
- **uid**: The unique number of each placed record, used to select, change or link it.
- **Studio star**: A star you placed. Whether it was collected is part of the project's save; the star
  counter adds it to the game's stars.
- **`.s64hack`**: The project file: one zip with everything in a project. Drop it on the home screen to open it.
- **Playable game**: The export of your hack as a small static website, without the editor.
- **Version**: A snapshot of the whole project you can go back to.
- **Workspace**: One part of the studio: Play, Build, Story, Assets, Sound, Game, Test.
- **Command palette**: `Ctrl+P`: a search for every action, tool and level.
- **Shine Sprite, Pianta, Noki**: Things from Super Mario Sunshine that Studio 64 can bring into SM64 from your own Sunshine disc.
  See [Sunshine characters](sunshine.md).

## Technical

- **ROM**: The game cartridge's data as a file (`.z64`). Studio 64 needs your own copy of the US version.
- **Decomp** (decompilation): The [n64decomp/sm64](https://github.com/n64decomp/sm64) project: the game's source code,
  rebuilt by hand in C, which builds back to the same ROM. It holds no game assets; those are
  extracted from your ROM.
- **sm64ex**: A [PC port](https://github.com/sm64pc/sm64ex) of the decomp. Studio 64's engine is sm64ex with
  added editing code, compiled for the web.
- **WebAssembly** (wasm): Code that runs in the browser at near-native speed. The game is compiled to it with
  **Emscripten** (emsdk).
- **Level script**: The decomp's description of a level: which areas, models, objects and warps it has.
- **Geo layout / display list**: How the game describes a model: a geo layout is the tree of parts (with animation and
  billboards), display lists are the drawing commands (triangles, textures) for the N64's
  graphics chip.
- **Macro object / special object**: Compact ways the game lists objects in a level (common objects like coins and trees). The
  catalog reads them too.
