# ROM export

Turn your hack into a real Nintendo 64 ROM. You get two files:

- a **.bps patch**, the file you share. Upload it to SMW Central, Romhacking.net, RHDC or anywhere
  else. Players apply it to their own *Super Mario 64 (USA)* `.z64` ROM with
  [Floating IPS](https://www.smwcentral.net/?p=section&a=details&id=11474) or
  [Rom Patcher JS](https://www.marcrobledo.com/RomPatcher.js/).
- a **.z64 ROM**, for you to play in an emulator: Project64, mupen64plus, RetroArch, simple64.

The patch only holds your changes, so it's fine to post publicly. The ROM contains Nintendo's game,
so keep that one to yourself.

## How to export

1. Open your hack in the editor.
2. ⋯ menu → **Export ROM hack…** (or *Share* → *ROM hack*).
3. Type the name the ROM should carry (20 letters, it goes into the ROM's header), then
   **Build the ROM**.
4. Download the `.bps` and, if you want to play it right away, the `.z64`.

While it runs, Studio 64 visits each of your areas to read them, so you'll see the game jump
around for a few seconds. You end up back where you were.

Exports take seconds. Every export starts from Studio 64's base ROM: the game rebuilt from the
[SM64 decompilation](https://github.com/n64decomp/sm64) with Studio 64's own code. It comes with
Studio 64 as a patch, like any ROM hack, and the first export applies it to your own ROM. The
result is kept in your user cache folder (`~/.cache/studio64/romkit` on Linux) for all your
projects.

## Only your own work goes out

Studio 64 ships no Nintendo files, and neither does what you share: the `.bps` is a patch for the
original *Super Mario 64 (USA)* ROM, the way ROM hacks are shared on romhacking.com, RHDC and the
like. It is useless without the player's own copy of the game. It only carries the parts of
Studio 64 your hack uses (a hack without cars doesn't carry the cars).

Characters from Super Mario Sunshine stay out of ROM hacks: their models are Nintendo's, from
another game, so a patch you share must not contain them. In Studio 64 they stay, and the export
dialog lists the ones it left out.

## Where your levels go

The ROM is still Super Mario 64, so your levels need a place in it.

| In Studio 64 | In the ROM |
|---|---|
| Your hub (World → hub) | Replaces the castle grounds. A new save file starts there, without the intro. |
| Your other levels, in the order of the level list | Course 1 to 15. The castle's paintings lead to them, and the act select and pause menu show your level and star names. |
| Changes to the original levels (objects, blocks, roads and plants, sculpted ground, removed objects, pipes, music) | Go into those levels. Everything else stays as it was. |
| Stars and deaths in a course | Bring Mario back to your hub, or to the castle if you have none. |
| "Exit course" in the pause menu | Goes to your hub. |

Areas, doors (with their star counts), pipes, paintings, warp zones, exit zones and arrival points
all work across your levels. A painting is drawn as part of the wall; walk or jump into it.

The export also brings over each area's sky, music, weather, sun light, fog, light tint, camera
mode, water and the height where falling kills.

## What your hack keeps in the ROM

Studio 64's own features work in the ROM too:

- **Story**: talking characters, dialogs with answers, events, conditions, cutscenes with their
  camera, captions and fades, objects that appear and disappear, rewards.
- **Keys and locks**: keys to pick up, doors that need a key, a number of stars, or the story.
- **Saving**: what the story has done, the keys Mario holds and the doors he opened are kept in
  the save file with the stars. Like in Studio 64, the game saves by itself when they change.
- **Custom objects and enemies** built from behavior blocks, and moving blocks and models.
- **Roads, fences and plants** from Roads & Nature, solid where they are in Studio 64. The game's
  own trees stay real trees that Mario can climb.
- **Sculpted ground in the original levels.** The parts you changed are rebuilt from the level's
  own textures and drawing commands, so the patch carries your shapes and none of Nintendo's
  pictures. The collision follows the new shape.
- **Game rules**: jump heights, gravity, speeds, switched-off moves, the HUD.
- **Your songs** from the sound studio, for an area or played by the story, and **game sounds you
  replaced** with your own (up to 16; the ROM plays them as N64 samples, 16 kHz, at most 3 seconds).
- **Cars and races** (with their HUD), **Shotgun Mario**, **Katana Mario**, and **Tokyo** with its
  city life: traffic, the train, pedestrians, oni.

These come with the base ROM. A level loads the ones its objects and rules need when Mario enters
it, so a level without them has all of the N64's memory for itself.

## What doesn't go into the ROM yet

The dialog lists everything it had to leave out, with the reason. Right now that's:

- Sunshine characters (Nintendo's models, see above).
- Fog and a light tint on the original levels. (Your own levels have both.)
- A level has one sky. When its areas have different ones, they all get the first area's.
- An object that needs an enemy bank the level doesn't load. The N64 loads one bank of each kind
  per level, and the dialog says which object wanted which.
- A story with very many events, objects and number variables can be too big for the save file
  (52 bytes per file). The dialog says so; what doesn't fit starts over when the game is turned off.

## Limits

- 15 levels of your own, plus the hub. Further levels are left out (the dialog says which).
- Your levels can reach 16,000 units from the centre in every direction, twice the original
  game's range.
- The ROM needs the Expansion Pak (8 MB). Every common emulator has it on by default.
- Textures are resized to fit the N64's texture memory (64×32 or 32×64 at most), so very detailed
  pictures look softer than in Studio 64. Textures with few colours keep every colour exactly and
  take a half or a quarter of the memory.
- Big areas get simpler collision than what they show: within 8 units of the ground you see. It
  keeps the N64's memory and Mario's movement fast.
- On the N64 the fog covers the level itself; objects in it stay clear, as in the original game.
- A very big level takes a lot of the N64's memory. Tokyo, the biggest sample, fits with its
  traffic and pedestrians.

## For the curious

The base ROM is the decompilation built with Studio 64's engine code: the same story, rules,
motion and custom-object code the browser runs (`engine/src/studio`), plus what only the ROM needs
(`server/romexport/n64/`: reading the hack's data, saving, songs, the HUD of the cars). The bigger
features (Shotgun, Katana, cars, Tokyo) are modules: compiled once into the
base ROM with what they need to move in memory, loaded by a level that uses them
(`server/romexport/overlays.js`).

Every export then only adds data after it: each level becomes one block with its level script,
geo layout, display lists, textures, collision, its objects' set-up and the story. Edits to an
original level get a copy of its level script with the changes patched in. The code is in
`server/romexport/`, and `tests/suite/rom_format.test.mjs` checks the binary formats against what
the decomp's own macros compile to.

`node tools/make_romkit.mjs` builds the base ROM and writes it as the patch that comes with
Studio 64 (`server/romexport/base/`; a release can't be packaged without the one for its version).
It refuses a base ROM with Nintendo's models in it. Without the patch for the running version
(while working on the ROM's code), Studio 64 builds the base ROM itself with an N64 compiler it
downloads (Linux, Windows).
