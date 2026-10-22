# Katana Mario

Mario with a katana, ported from the hack **Shoggoth World** (Tokyo's maid café
"Moe Moe Heart" and its bonus star, *Showdown at the Maid Café*): the Legendary Blade stuck in the
floor, Mario's sword moves, the cosplayer fighters and their duel. Everything works with the mouse and
keyboard; the AI tools are an extra way to do the same.

- [Giving Mario the katana](#giving-mario-the-katana)
- [Playing](#playing)
- [The katana fighters](#the-katana-fighters)
- [The katana duel](#the-katana-duel)
- [Story events](#story-events)
- [For developers](#for-developers)

## Giving Mario the katana

| How | Where | Lasts |
|---|---|---|
| **Legendary Blade** in the floor | Build mode → Objects → **Shoggoth** → *Legendary Blade*, click where it stands. Playing, walk up to it: "**B** Pull the legendary blade" | until Mario leaves the level |
| Game rule **Mario starts with the katana** | **Game** panel (`P`) → *Items* (whole game or *This level*); preset *Katana Mario* | every level the rule covers |
| Story action **Give or take the katana** | Story → event → *Then* → Mario | until he leaves the level (or a *take*) |
| Story condition **Mario has the katana** | Story → *If* | |

**The pull**: B at the blade and Mario grabs the hilt with both fists, heaves (the camera low in front of
him), struggles, and out it comes: he raises it to a fanfare, sparks and confetti. The first time, a card
over the game shows the keys. Once he has it, the blade in the floor is gone (it comes back when he loses
the katana).

Mario carries **one weapon at a time**: the katana replaces the shotgun and the other way round (also
for the game rules: switching one on switches the other off).

## Playing

| Key | Pad | What |
|---|---|---|
| `J` | B | **Cut**. Press again during a cut for the next one: the **three-cut combo** (right to left, a rising cut, an overhead cleave with a step forward) |
| `J` in the air | B | **Spin slash**: two full turns, hanging in the air a moment; once per jump |
| `Shift` + `J` | Z + B | **Dash slash**: a breath, then he's through them (~650 units in six frames) -- the cuts land a beat later, when the blade clicks back |
| `J` while running | B | **Lunge**: a cut with a big step |
| `Space` after a cut | A | cancel the recovery into a jump |

His arms hold the blade over whatever his legs do (posed by inverse kinematics from the hack's own
tables: the blade in his right fist, the left fist on the grip below it) and lower it while his hands
are busy (ledges, poles, swimming, carrying). Every cut leaves a **crescent** (electric blue; the spin's
is pink, the dash's gold), every hit throws **sparks**, freezes the fight a few frames (**hit-stop**) and
shakes the camera, with a manga word over it: **ズバッ** on a cut, **ドン!** on a finisher, **キン!** on a
parry, **NANI?!** over the fallen.

### What a cut does

A cut hits everything in its arc (about 250 units from his chest, wider for the spin), each thing once
per cut, the same way a [shotgun](shotgun.md#how-things-react) blast does: Goombas, Koopas, Boos,
Bullies, Piranha Plants and the rest are knocked out (coins), Bob-ombs go off, boxes break, Chuckyas
burst after two cuts, King Bob-omb takes a hit every third cut, armour (Bowser, Thwomps, invincible
custom objects) only rings with sparks and a **キン!**, your custom enemies take a hit if their *Defeat*
allows punch & kick, Sunshine enemies take theirs, Piantas get mad, gangsters fall. Every placed object
hit fires the story trigger **A custom object reacts → is hit**. The dash's cuts land at its click.

## The katana fighters

Objects → Shoggoth → **Katana fighter**: Toads in costume (Shoggoth World's dressed Toads: the cap
recoloured as the hero's cap with its emblem, a stuck-on moustache, overalls; Peach, Yoshi). Pick the
**Look** in the inspector: *Mario (the boss)*, *Luigi*, *Wario*, *Waluigi*, *Peach*, *Yoshi*.

A placed fighter parties (poses, talks, dances) until Mario comes near (1100 units). Then he jumps and
shouts, draws his replica katana from his back and fights:

- he **circles** Mario at sword's length, strafing, taunting ("Bro, your hat's the wrong red.");
- before a cut his blade **glints** (the telegraph), then he **cuts** (2 damage; the Mario cosplayer 3);
- he **parries** cuts he sees coming (*キン!*, Mario staggers back) and answers with a quick **riposte**,
  or **dodges** back out of a cut;
- the **Mario cosplayer** is the boss: 20 cuts to put down, he leaps in from a distance and **slams**
  the floor (a shockwave), and at half health he **rages** (faster windups, three cuts in a row).

Health in cuts: Mario cosplayer 20, Wario 6, Luigi 5, Waluigi 5, Yoshi 5, Peach 4. A fighter also takes
Mario's punches, kicks and stomps, and shotgun blasts (one cut each). Down, he spins back with a
*NANI?!*, falls and poofs into confetti and coins. If Mario runs off (2600 units), he walks back to his
spot and puts the katana away. People between the camera and Mario fade to see-through.

## The katana duel

Objects → Shoggoth → **Katana duel**: the maid café's whole fight as one object. Place it in the middle
of a free floor about 2000 units across (the fight keeps within 1100 units of it).

1. Six fighters party round it (where they stood in the café).
2. Mario comes near (900 units): everybody gasps ("Is that... a second Mario?"), the **Mario
   cosplayer** walks up to him and makes his speech (a real dialog box: "Why are you wearing the same
   costume as me?! ... FIGHT ME!").
3. If Mario has no katana, the **Legendary Blade** is stuck in the floor by the duel's spot ("Pull it out,
   fake!"); with one already, the fight starts.
4. **The fight**: the battle theme (*Samurai Cosplay Overdrive*), everybody draws their replicas, then
   three **waves**: Luigi, Yoshi and Peach (one at a time); Wario and Waluigi (together); the Mario
   cosplayer alone. Their lines pop up in speech bubbles at the bottom, the **cosplayers left** on a pink
   pill bottom left.
5. **The finale**: the last cut on the Mario cosplayer is slow motion with a white flash; Mario's
   flourish puts the blade away; the cosplayer's last words; the **star** comes out of him.
6. **Losing**: if Mario's health runs out during the fight he is knocked down, not killed: the
   fighters go back to their places, healthy again. Walk back to the Mario cosplayer for a rematch
   ("YOU again?! The copycat!").

The inspector's **Katana duel** section: *A star for winning* and its name. It is a star of the level:
it shows on the Stars tab, the star screen and the counter, and collecting it finishes the level like
any star.

## Story events

| | |
|---|---|
| When: *A katana duel starts or ends* | a duel (or any): it starts, Mario wins, Mario loses |
| If: *Mario has the katana* | |
| If: *A katana duel is won* | a duel (or any), remembered in the save |
| Then: *Give or take the katana* | |

Placed fighters report through the usual *An object is defeated or gone* trigger.

## Saved where

- The blade, fighters and duels: records in the area (`entry: "kt:blade"` / `"kt:fighter"` / `"kt:duel"`;
  a fighter's look is bparams byte 2, `0x00LL0000`; a duel's reward is `star: { name }` with its star
  number in bparams byte 1).
- The rule: `@game.rules.base.katana` / `@game.rules.levels[<level>].katana`.
- Story: the trigger `{ type: "katana_duel", uid, result }`, conditions `{ type: "katana", value }` and
  `{ type: "katana_duel_won", uid, value }`, the action `{ type: "katana", on: "give" | "take" }`.

All of it travels in the `.s64hack` project file and the standalone player.

## AI tools (`server/tools/katana.js`)

`katana` (`give`, `take`, `rule_on` / `rule_off` for the game or one level, `blade`, `fighters` with a
count and looks, `duel` with a star name) and `get_katana_state`. Examples: "give me the katana", "put a
katana duel here", "place Luigi and Peach as katana fighters".

## For developers

| File | What |
|---|---|
| `engine/src/studio/katana.c` | Katana Mario (from the hack's `overlay/katana.c`): the actions `ACT_KT_*`, input, the IK arm poses over his animation, the blade in his right fist, crescents, sparks, glints, confetti, hearts and manga words, hit-stop, the pull and finale cameras, cutting other objects (`kt_strike_objects` with `studio_weapon_react` from shotgun.c), the API |
| `engine/src/studio/katana_fighters.c` | the fighters, the duel and the blade (from the hack's `overlay/maidcafe.c`), `geo_kt_katana_switch` and `geo_kt_fade` for their models |
| `engine/src/studio/katana_behaviors.c`, `katana_bhv.h`, `katana.h` | behavior scripts, hooks and the attack contract (`struct KtAttack`, `kt_attack_hits`) |
| `engine/src/studio/katana/` | `models.inc.c` (the blade, the cosplayers, their animations `kt_toad_anims`, the effect textures), `katana_poses.h` (the IK tables), both made by `tools/katana_extract.py`; `rom_recipes.json` (the vanilla Toad pieces, made from your ROM at build time: [Building the engine](building-the-engine.md#the-shoggoth-content)); `catalog.json` (the library entries) |
| `web/data/katana.json` | the fighters' lines (the hack's `TEXT_MC_*`), the four speeches, the battle theme (`.m64`, on the Tokyo bank) |
| hooks | `mario.c` (`studio_katana_before_step` after the cars', `ACT_KT_*` dispatch, `studio_katana_after_step`), `camera.c` (`studio_katana_camera`), `rendering_graph_node.c` (`studio_katana_anim_part`, `studio_katana_part_drawn`) |
| `web/js/katana.js`, `web/css/katana.css` | level resets, the speeches as project dialogs (ids 2296-2299), the battle theme in the preview song slot, the overlay (bubbles, prompt, counter, flash), the how-to card, the duel's inspector, RPCs |
| `web/js/objects/game_rules.js`, `web/js/story/schema.js`, `runtime.js` | the rule (one weapon at a time), the story trigger, conditions and action |
| `tests/suite/katana.test.mjs` | the test: `node tests/run.mjs katana` |

Engine exports: `studio_katana_give(on)`, `studio_katana_has()`, `studio_katana_rule(on)`,
`studio_katana_level_start(rule)`, `studio_katana_duel_config(slot, star, starDone)`,
`studio_katana_state_json()` (has, action, cut, swings, hits, objHits, hitstop, slowmo, prompt,
pullGap, words, lastKinds, and `duel`: phase, wave, alive, fighters, bubbles),
`studio_katana_debug_pose(n)` and `studio_katana_debug(op)` (tests: 1 every fighter down to one cut,
2 Mario nearly out of health, 3/4 the fighters never attack / do again, 5/6 no parries or dodges).
Page events: `Module.studioKatanaEvent(kind, uid, value)` → window `studio:katana`
(`pulled`, `phase`, `start`, `wave`, `won`, `lost`, `music`, `spotted`, `fighter_hit`, `fighter_down`).

Differences to the N64 original: resident code instead of the café's code overlay; direct hooks instead
of `gShHooks`; the blade drawn from the fist's own animated part instead of the hack's `SH_MGEO_RHAND`
node in every Mario geo (so imported or recoloured Marios carry it too); cuts hit every object, not only
the cosplayers; the duel happens wherever its object stands instead of the café's room (no maids, no
ceiling vent, no grille, no front door), the short lines are drawn by the page in the café's kawaii
style instead of the hack's HUD kit; Mario keeps the katana after the flourish; a lost duel is a
knock-down with a rematch instead of Mario's death; placed fighters fight on their own, and fighters
take punches, stomps and shotgun blasts too. The sounds are the game's own, as in Shoggoth World.
