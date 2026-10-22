# Shotgun Mario

Mario with a pump-action shotgun, ported from the hack **Shoggoth World** (its New York
"hood" sub-area), which follows the mechanics of Dorrieal's *Shotgun Mario 64*. Everything works
with the mouse and keyboard; Claude's tools are an extra way to do the same.

## Giving Mario the gun

| How | Where | Lasts |
|---|---|---|
| **Shotgun** pickup | Build mode → Objects → **Shoggoth** → *Shotgun*, click where it lies | until Mario leaves the level |
| Game rule **Mario starts with the shotgun** | **Game** panel (`P`) → *Items* (whole game or *This level*); preset *Shotgun Mario* | every level the rule covers |
| Story action **Give or take the shotgun** | Story → event → *Then* → Mario | until he leaves the level (or a *take*) |
| Story condition **Mario has the shotgun** | Story → *If* | |

The pickup floats and turns; walking into it arms Mario (a 1-up jingle and a short card with the
keys over the game). While Mario already has the gun he walks past pickups. A sub-area of the same
level keeps the gun; a different level starts over (armed again if the rule says so).

## Playing

| Key | Pad | What |
|---|---|---|
| `J` or `Q` | B or L | Fire. Hold for automatic fire: a blast every 26 frames, the pump racks in between |
| `J` / `Q` in the air | B / L | **Shotgun jump**: a blast straight down, up speed to at least 54 (36 out of a long jump), once per jump |
| `R` | R | **Aim mode** on/off: over-the-shoulder camera with a crosshair |
| Arrow keys | C buttons | In aim mode: move the sight (speeds up while held) |
| Arrow up (first person) | C-up | Shots go where he looks |

While he carries it, B no longer punches, kicks or dives (talking to characters and reading signs
still work). He keeps running and jumping: his arms hold the gun over whatever his legs do, raise it
to fire, kick back with the recoil, rack the pump, point it down for the shotgun jump, and sling it
on his back while his hands are busy (ledges, poles, swimming, carrying things).

### What a blast does

- **Five pellets** (hitscan, 5461 units): one down the middle, four in a pattern that keeps about the
  same size on the target at any distance (a choke).
- **Walls** take bullet holes (the 32 newest stay), smoke, sparks and chips; moving things only spark.
- **Up to 8 objects** in the path are hit (the blast has ~111 units of tolerance round a hitbox);
  walls in between block it.
- No recoil on the ground; the camera shakes; the muzzle flashes.

### How things react

| Object | Reaction |
|---|---|
| Goombas, Koopas, Boos, Bullies, Piranha Plants, Spinies, Fly Guys, Snufits, Swoopers, Monty Moles, Mr. Blizzards, Scuttlebugs, Skeeters, Pokeys, Bookends, Clams, Bubba, Wiggler, Eyerok's hands, the haunted furniture, ... | as if slide-kicked: knocked back and defeated (coins), or whatever their own code does with a hit (Wiggler is only knocked back: he still needs stomps) |
| Bob-ombs | go off |
| Breakable boxes, `!` boxes | break / open |
| Cork boxes, jumping boxes | break (coins) |
| Chuckya | two blasts and it bursts (coins) |
| King Bob-omb | three blasts are one hit (like a throw), while he walks the summit |
| Big Bully, Chill Bully | knocked back (into the lava) |
| Bowser, Heave-Ho, Thwomps, Whomps, invincible custom objects | sparks only |
| Your custom enemies | a hit, if their *Defeat* allows punch & kick (health, blinking, defeat effect) |
| Sunshine enemies (Strollin' / Swoopin' Stu, Electrokoopa without its shell, Pokey, Cataquack, Blooper) | a hit (their own reactions) |
| Piantas and Nokis | get mad (they are friends: nothing worse) |
| Gangsters | blown back along the shot and out (coins) |
| Mario's friends, coins, stars, NPCs | not hit |

Every placed object hit by a blast also fires the story trigger **A custom object reacts → is hit**
(custom objects report their own hits).

## Gangsters

Objects → Shoggoth → **Gangster**: the gangsta Goombas of the hood (bandana and shirt in three looks,
inspector *Look*). They hang out bobbing until they see Mario (1800 units, line of sight), jump and
shout, and the whole crew around them opens fire: they keep a shooting distance, strafe, plant their
feet and fire short bursts of tracers (1 damage; never more than three aiming at once). Ones on a
roof or ledge hold their spot. One blast, a stomp or a punch puts a gangster down.

The hood's own story (the shout, the star when the block is clear) is yours to build with the
story: *An object is defeated* on each gangster, a counter, *Give a star*.

## Claude's tools (`server/tools/shotgun.js`)

`shotgun` (`give`, `take`, `rule_on` / `rule_off` for the game or one level, `pickup`, `gangsters`
with a count) and `get_shotgun_state`. Examples: "give me the shotgun", "Mario starts with the
shotgun in this level", "put a gang of 6 gangsters on the street".

## Saved where

- Pickups and gangsters: records in the area (`entry: "sg:shotgun"` / `"sg:gangster"`, bparams byte 2 = look).
- The rule: `@game.rules.base.shotgun` / `@game.rules.levels[<level>].shotgun`.
- Story: actions `{ type: "shotgun", on: "give" | "take" }`, conditions `{ type: "shotgun", value }`.

All of it travels in the `.s64hack` project file and the standalone player.

## For developers

| File | What |
|---|---|
| `engine/src/studio/shotgun.c` | the port: firing, raycasts, hits and reactions (`sg_react_kind`, `sg_react`), effects, aim camera, crosshair, IK-solved arm poses, drawing |
| `engine/src/studio/shotgun_objects.c`, `shotgun_behaviors.c`, `shotgun_bhv.h` | pickup, gangsters, bullets |
| `engine/src/studio/shotgun/` | models and textures (made by `tools/shotgun_extract.py` from Shoggoth World's hood data, fog stripped; they ship with Studio 64), `rom_recipes.json` (the gangsters' re-lit Goomba feet and recoloured faces, made from your ROM at build time: [Building the engine](building-the-engine.md#the-shoggoth-content)), `catalog.json` (library entries, read by `tools/gen_catalog.py`) |
| `engine/src/studio/shotgun_models.h` | the models, or empty stand-ins (`SG_STUB`) for a tree without them: the engine builds, the Shotgun objects and the shotgun rule are left out, and the gun stays off |
| `engine/src/studio/shotgun.h` | hooks and the hit contract (`gShotgunHit`, `gShotgunHits`, `studio_shotgun_hit_for`) |
| hooks | `mario.c` (before/after Mario's step), `camera.c` (aim camera), `hud.c` (crosshair), `rendering_graph_node.c` (arm poses, the gun on his torso, world effects; `studio_geo_append`) |
| `web/js/shotgun.js`, `web/css/shotgun.css` | level resets, the how-to card, RPCs |
| `web/js/objects/game_rules.js` | the *Items* section and preset |
| `web/js/story/schema.js`, `runtime.js` | the story action and condition |
| `tests/suite/shotgun.test.mjs` | the test: `node tests/run.mjs shotgun` |

Engine exports: `studio_shotgun_give(on)`, `studio_shotgun_has()`, `studio_shotgun_rule(on)`,
`studio_shotgun_level_start(rule)`, `studio_shotgun_set_aim(on)`, `studio_shotgun_state_json()`
(has, rule, aim, timer, shots, objHits, decals, parts, lastDir, lastDist, camYaw, and the last
blast's `hits` with each object's reaction).

Differences to the N64 original: resident code instead of a code overlay (it does nothing until
Mario has the gun), direct hooks instead of `gShHooks`, the gun drawn from the torso's animated part
instead of `GEO_ASM` nodes in Mario's model (so imported or recoloured Marios carry it too), and the
reactions generalised from the hood's gangsters to every SM64 object. The sounds are the game's own,
as in Shoggoth World: the cannon's boom (blast), two key clacks (pump), a hit thud, the camera zoom
(aim mode) and the 1-up jingle (pickup); replace them in the Sound studio like any game sound.

Mario carries one weapon at a time: the [katana](katana.md) replaces the shotgun and the other way round.
The katana's cuts use the same reactions (`studio_weapon_react_kind`, `studio_weapon_react`).
