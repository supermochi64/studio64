# Stars

Stars are what a Mario level is about. Studio 64 lets you place your own anywhere, in your own
levels and in the original ones.

## Adding a star

Open the **Stars** tab in the side column (`Ctrl+J` shows the column when it is hidden). It lists the stars of the level you are in, with the
ones you collected marked.

| Button | |
|---|---|
| **Add star** | Name it, then click where it goes |
| **Red coin star** | Click where the star appears, then place the 8 red coins one by one. Collecting all 8 makes the star appear, like in the game. |
| **Shine Sprite** | A star with the look of Super Mario Sunshine's Shine Sprite (needs the [Sunshine characters](sunshine.md)) |
| **Reset** | Forget which stars you collected (to play the level fresh) |

Every star row has **Show it** (the camera flies there in build mode) and **Rename**.

A placed star is an ordinary object: in build mode you can select it, move it, duplicate it or
delete it like anything else.

## What collecting a star does

- The game's **course complete** screen shows your star's name and the level's name.
- The **star counter** in the HUD counts your stars together with the game's, so star doors in
  the castle open with them too.
- The **star screen** of the level (the act selector) lists your stars by name, collected ones
  bright.
- Your own levels also have the **100-coin star**: collect 100 coins in the level.
- Stars of every area of a level count for the level.

## Where progress is saved

Each project has its own **save**: the game's save file (the original courses' stars, keys,
caps, opened doors), the stars of your own levels, and the story's progress. It is kept in your
browser and, in the studio, mirrored to the server (`server/projects/playsaves/<id>.json`), so it
survives reloads, cleared browser storage and other browsers. It is not part of versions or
exports. The [play-test tools](testing-tools.md#save-file) can edit it (give 0 to 120 stars, set
keys and doors) or reset it; *Play from start* starts a fresh one. In the playable game, each
player's save stays in their browser.

## Checking your stars

**Test → Check level** finds stars that are under the ground, over the void, out of reach
(higher than Mario can jump), stuck in walls, or red coin stars with fewer than 8 red coins. Each
problem has **Show** and, where it is safe, **Fix**. See
[Play-testing tools](testing-tools.md#check-level-validator).

## Star doors and goals

- A door or warp can need a number of stars ("You need N more Stars"). See [World: warps](world.md#warps).
- The hack can have a **star goal** with a message when it is reached. See
  [World: hub and flow](world.md#hub-and-flow-patchworld).
- Story events can **give a star** (for example after talking to a character). See [Story](story.md).
