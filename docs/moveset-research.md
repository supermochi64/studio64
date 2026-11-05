# New moves: what other SM64 hacks and mods have

Research for the **New moves** group of the game rules (GitHub issue #8: "spinjump for triple jump,
instant groundpound, and modern wallsliding"). What the well-known movesets add, how you do each
move and how it behaves. Studio 64's versions are in `engine/src/studio/moves.c` and are described
in [objects.md](objects.md#game-rules).

**No code was copied.** None of the mods below states an MIT-compatible license (TheGag96's
sm64-port fork and the sm64coopdx mods publish no license for their moveset code), so Studio 64
re-implements each move from its description, with its own numbers, and uses only the
animations and sounds the game already has.

## Sources

- **Extended Moveset** by TheGag96 (sm64-port fork, also shipped with sm64ex-coop / sm64coopdx as
  `extended-moveset.lua`): new moves from Sunshine and Odyssey, partly recreations of Kaze
  Emanuar's moveset changes in Super Mario Odyssey 64 and Super Mario 64 Land.
  [README](https://github.com/TheGag96/sm64-port/blob/extended_moveset/README.md),
  [coop port](https://github.com/robertkirkman/sm64ex-coop/blob/android/mods/extended-moveset.lua)
- **Quality of Life Moveset** (sm64coopdx, TheBoiJoshua and EmeraldLockdown): ground pound in
  water, ground pound jump and dive (water too), ground pound from a rollout, faster twirl, wall
  slide. [mods.sm64coopdx.com](https://mods.sm64coopdx.com/mods/quality-of-life-moveset.45/)
- **Character Movesets** (sm64coopdx): a "spin pound" on Z without the pause in the air.
  [mods.sm64coopdx.com](https://mods.sm64coopdx.com/mods/character-movesets.191/)
- **Only Up 64** (and its coopdx port): ground pound twirl, ground pound jump and dive, wall slide
  taken from the Extended Moveset with tweaks (more gravity on the wall, wall slide after a long
  jump). [plugin](https://github.com/DizzyThermal/sm64coopdx-only-up-64-plugin)
- **Kaze Emanuar's hacks** (Super Mario Odyssey 64, SM64 Land, Return to Yoshi's Island 64):
  ground pound jump, wall slide and double jump "like in Mario Odyssey".
  [N64 Squid on RTYI](https://n64squid.com/homebrew/roms/return-to-yoshis-island-64/),
  [Mario 64 hacks wiki: Last Impact](https://mario64hacks.fandom.com/wiki/SM64:_Last_Impact)
- **Move Your Body Freely 64** (SMW Central): a "speed pound" that keeps momentum, ground pound
  landing cancels.

## The moves

| Move | Input | Behaviour in the hacks | Hacks | Studio 64 |
|---|---|---|---|---|
| Wall slide (Sunshine / Odyssey) | jump into a wall | holds on and slides down instead of bonking (Extended Moveset: from the air-hit-wall state when slower than 38, speed held at the wall, falls 2 per frame up to 15); A kicks off (up 52, the reflected angle); too fast still bonks | Extended Moveset, QoL, Only Up 64, Kaze's hacks | **yes**: up to 20 per frame, Z lets go, no fall damage after a slide |
| Spin jump (Sunshine) | rotate the stick a bit more than half a circle, then A; a spin during most jumps turns them into one | twirl animation, as high as a ground pound jump, slow fall; no ledge grab | Extended Moveset, Kaze's Last Impact (triple jump spin) | **yes**: stick spin (≥ 200° in 12 frames) or L + A (keyboard friendly); a spin in a jump lifts a little; falls at most 36 per frame |
| Spin pound (Odyssey) | Z during a spin jump | straight down at once like a ground pound, faces the stick on landing | Extended Moveset, Character Movesets | **yes**, part of the spin jump |
| Spinning triple jump | the third jump | the triple jump as a twirl (the issue's request; Last Impact has a "triple jump spin") | Last Impact | **yes** (its own switch) |
| Instant ground pound | Z in the air | no flip and pause before the drop | Character Movesets (spin pound), Move Your Body Freely 64 (speed pound) | **yes** (also the underwater pound) |
| Ground pound jump (Odyssey) | A right after a ground pound lands | a straight-up jump between a side flip and a triple jump (Extended Moveset: 65) | Extended Moveset, QoL, Only Up 64, Kaze's hacks | **yes**: 66 up, no forward speed |
| Ground pound dive (Odyssey) | B during a ground pound | a slowish dive forward with a little height | Extended Moveset, QoL, Only Up 64, Kaze's hacks | **yes**: 30 forward, 30 up, aimed with the stick |
| Ground pound from rollouts / long jump | Z | the game allows a ground pound only from some jumps | QoL (from a rollout) | **yes**: long jump, rollouts, jump kick |
| Underwater ground pound (Odyssey) | Z under water; a ground pound into water goes on | sinks to the floor; A on the floor jumps up (out of the water near the surface) | Extended Moveset, QoL | **yes** |
| Dive hop (Sunshine) | B while belly sliding | another small dive | Extended Moveset | **yes**: keeps the slide's speed (no extra speed to chain) |
| Ledge vault (Super Mario Run) | B within a few frames of a ledge grab, with a run-up | vaults over, keeps the speed plus a little | Extended Moveset | **yes**: B within 4 frames of the grab, needs speed 20 |
| Roll (Odyssey) | crouch + R, or Z on landing from a long jump / dive / ground pound | a fast roll that speeds up with more presses; A long jumps out | Extended Moveset | no: R is the camera button in SM64 and Studio 64 |
| Tight controls | stick back on the ground | reversing turns speed around | Extended Moveset (Keanine's Tight Controls) | no: changes the feel of every level, not a move |
| Cap throw / Cappy (Odyssey) | Y / X | throws the cap, captures | Kaze's Odyssey 64, coop mods | no: needs new models and objects |

## Walking and crouching

The issue also asked for switching off walking and crouching. Crouching could already be switched
off. "Walking" is now a switch of the game's moves: off, any tilt of the stick runs at full speed
(no tiptoeing); on a keyboard Mario always runs anyway.
