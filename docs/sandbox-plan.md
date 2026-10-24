# Sandbox: plan

A city sandbox ROM hack made with Studio 64: a neighbourhood with cars driving around, people
walking, weapons, gangs you can recruit, shootouts and bikes. It plays on SM64's engine and moves
(run, triple jump, wall kick, ground pound) and ends up where every Studio 64 hack ends up: an N64
ROM and a `.bps` patch that play in any N64 emulator.

Status: plan. Nothing here is built yet. This branch is merged only once it plays well in an
emulator.

## Hard rules

1. **N64 first.** Every feature is engine C code in `engine/src/studio/` that runs in the browser
   build *and* in the ROM export. A feature that can't go into the ROM doesn't ship. Each one is
   tested in an emulator (mupen64plus / Project64 / RetroArch with the Expansion Pak), not only in
   Studio 64.
2. **None of Nintendo's content in sight.** No Mario, no Toads or Goombas, no SM64 levels, textures,
   music or game materials. Everything you see is made for the sandbox: the city, the player, the
   people, the cars, the weapons. The engine code and Mario's animations come from the player's own
   ROM when they apply the `.bps`, the same way every SM64 hack works. The patch doesn't contain
   them, and the ROM export already refuses Nintendo models (`NINTENDO_IDS` in
   `server/romexport/overlays.js`).
3. **Easy to extend.** New weapons, vehicles, character looks and gang setups are table entries plus
   a model, not new code paths.
4. **Not called GTA.** The working title is *Sandbox*. All names (city, gangs, shops) are our own.

## What already exists and goes into the ROM today

| Need | Existing piece | Can it be used as is? |
|---|---|---|
| Driving | `vehicle.c` (Shoggoth's car core: physics, crashes, chase camera, getting in and out), `vehicles/cars.inc.c` | Yes. The car models are the Shoggoth author's own work. Add looks (lowrider, pickup, police) and a **bike** (below). |
| Traffic | `vehicle_race.c` `bhvStudioTrafficCar`; Tokyo's traffic in `shoggoth/tokyo.c` | The logic yes. It's tied to race paths and Tokyo's lanes, so it needs a version that drives on roads drawn with *Roads & Nature*. |
| Pedestrians | Tokyo's `bhvTkPedestrian` | The logic yes, the look no: it's Toad (Nintendo). Needs our own human model. |
| Guns | `shotgun.c`: hitscan raycasts, hits, reactions, aim camera, crosshair, arm poses, recoil, bullet holes | Yes, as the base of a weapon table (pistol, SMG, shotgun, rifle). |
| Shooting enemies | Shotgun gangsters: see Mario, keep their distance, strafe, fire bursts | The logic yes, the look no: they're dressed-up Goombas. |
| City | Custom levels, blocks, roads, fences, plants, imported models, custom materials (slots 48–63), sky, songs | Yes, with **custom materials and models only**, not the 29 game materials. |
| Modules in the ROM | `server/romexport/overlays.js`: the shotgun, the katana, cars and Tokyo load as overlays | Yes. The sandbox becomes one more module, `sandbox` with catalog ids `sbx:*`. |

## What's missing

### M1: the neighbourhood and the player (first playable)
- **The player is not Mario.** A Nintendo-free human model (cap, shirt, jeans) on Mario's skeleton,
  so all of SM64's moves and animations work. This needs a new hook: Mario's geo node swapped for
  ours (`studio_player_look`), with its own display lists per body part. The browser and ROM use
  the same data.
- **The city: "Palm Court"**, one area (about ±16,000 units: a few blocks) built by a level
  template (`web/js/templates.js`):
  - a cul-de-sac of houses with yards and fences, a corner store, a basketball court and an
    alley;
  - streets and sidewalks from *Roads & Nature*, palms;
  - only custom materials (stucco, asphalt, brick, roof, made from patterns);
  - its own sky and song.
- **Our own human model** for pedestrians and gang members: a low-poly body made of boxes, with
  colour variants, animated by code (walking, running, falling) so it needs no animation data from
  the ROM.
- **Pedestrians** walking the sidewalks (they follow the road network), fleeing from gunfire, and
  falling down when shot or run over.

### M2: weapons and shootouts
- **A weapon table** built on `shotgun.c`, with an entry per gun: damage, rate, magazine, spread,
  sound and model. Pistol, SMG, shotgun, rifle; fists stay Mario's punch and kick.
  - pickups on the street;
  - L/R pick the weapon, Z+R aims;
  - the N64 pad's buttons are few, so the scheme is planned in an emulator.
- **Health and armour** that go with guns, instead of the 8-wedge power meter. The HUD has our
  own numbers and icons.
- **Gangs**:
  - three factions with their own colours: *Palm Court* (yours, green), *Violet Kings* (purple),
    *Gold Coast* (yellow);
  - each controls part of the map; rivals open fire in their part of the map, and gangs fight each
    other where their areas meet.

### M3: recruits and gang wars
- **Recruiting**: aim at a Palm Court member and press a button. Up to 3–4 follow you (the N64's
  object budget), shoot whoever attacks you or whoever you aim at, and get into your car as
  passengers.
- **Gang wars**: start a fight in a rival block, survive the waves, and the block becomes yours.
  It's saved in the save file (the story's save bits are already in the ROM, `s64_save.c`).

### M4: bikes and more
- **Bike**: a look and a tuning of the car core. Narrow, leans into turns, a hop, and the rider
  flies off in a crash.
- **Police**, at first one wanted level: cops on foot and in cars after a crime.
- More areas joined by roads at the map's edges (each is a level of the ROM). A city bigger than
  one area comes from several districts, not one big map.

## N64 limits that shape the design

- **About 240 objects** in total, so people and cars appear around the player and disappear far
  away: about 12 people, 6 cars and 3–4 recruits at once.
- **One area is about ±16,000 units.** At Mario's scale (about 160 units tall) that's a
  neighbourhood, not a whole county. Bigger means more districts.
- **8 MB of memory** (Expansion Pak, already required), and Tokyo already fits with its traffic
  and crowd. Texture memory is 4 KB: textures at most 64×32, so the city's look is flat colours
  and small tiling textures.
- **Collision is the level's surface pool** (about 57,000 triangles), plus moving objects.

## Extending (the "easy to add" part)

- `engine/src/studio/sandbox/weapons.c`: `gSandboxWeapons[]`, one entry per weapon.
- `engine/src/studio/sandbox/looks.c`: `gSandboxLooks[]`, one entry per character look (model and
  colours).
- `gangs.c`: `gSandboxGangs[]`, one entry per gang (colour, looks, weapons, how aggressive).
- Car and bike looks: `gStudioCarLooks[]` (exists).
- Each table entry is also a catalog entry (`sbx:*`), so Studio 64's build mode, its story events
  and the AI tools (`server/tools/sandbox.js`) can place and use it like any other object.
- **Sharing a character**: a look plus its settings (gang, weapons, behaviour) as a small file
  that imports into another project, like prefabs today. It holds our own models and data only,
  so it's safe to share.

## How it gets tested

The engine and the ROM need the player's own SM64 ROM to build (`engine/baserom.us.z64`). Every
milestone is checked in three places before it's called done:
1. Studio 64 (the browser build): a test in `tests/suite/sandbox*.test.mjs`.
2. The exported ROM in an emulator: boot, play the feature, and check the frame rate and memory.
3. `tests/suite/rom_format.test.mjs` and `rom_export.test.mjs` still pass.
