# Story: dialogs, characters, logic, cutscenes, start and ending

Everything a storyline needs, without code: the **Story** panel (top bar or rail, key **Y**) and
build mode's **Logic** tab. Everything works from the UI alone; Claude has the same abilities as tools.

## Using it

**Dialogs.** Write what characters, signs and events say. The text wraps by itself to the game's
box width (turn it off for exact line breaks); a blank line starts a new box. The preview draws it in
the game's own font, box and page breaks, over a picture of the game, with a pager per box. Lines too
wide and characters the font does not have are flagged. The glyph bar inserts the game's specials:
`[A] [B] [Z] [R] [C]` buttons, `^ | < >` C-buttons, `★ ☆`, `$` (coin), `×`, `[%]` (a number). Options:
lines per box, box position, a voice (the sound when the box opens), and **questions** with two answers
(stored in a flag, or used by "talk" triggers and `If` actions). "Used by" lists every character, event
and cutscene that says it; **Show in game** opens it in the running game.

**Characters.** Anyone Mario can talk to (walk up, press B): Toad, Bob-omb Buddy, sign post, wall sign,
Pianta (man/woman), Koopa, Goomba, penguin, Yoshi, Peach, Ukiki, Chuckya, Bob-omb, Boo. They appear in
front of Mario (Story panel) or in the middle of the view (Logic tab), turn toward Mario and say a
dialog. A character has **lines**: the first whose conditions hold is said ("If gate open → You did
it!", otherwise "Find the gate"). **After talking** creates events (give a star, coins, a cap, open
something...). In build mode, the inspector of any object has **Make it talk**, so original Toads,
signs and Piantas can say project dialogs too.

**Logic** is the heart of a story. Each event is **When** → **If** → **Then**:

- *When*: Mario enters / leaves a zone, talks to a character (optionally: picks the first/second
  answer), collects a star (or any), has N coins, collects N red coins, an object is defeated or
  gone, a switch is pressed, a custom object (docs/objects.md) spots Mario / is hit / hurts Mario / is defeated, N seconds after entering a level, enters a level or one of its areas (a sub-area like the inside of a house: `c:<id>:<n>`; *Main area* means only area 1), a variable reaches a
  value, a new game starts, a [katana duel](katana.md#the-katana-duel) starts, is won or lost.
- *If* (all must hold): flag set / not set, counter compares, total stars, coins, lives, health, Mario
  wears a cap, the act, in a level, another event happened, a star collected, a random chance, Mario has the
  [shotgun](shotgun.md) or the [katana](katana.md), a katana duel is won.
- *Then* (one after another; a dialog waits until it is closed, a cutscene until it ends): show a
  dialog, a caption, set/toggle a flag, change a counter, show / remove an object, open a door or gate (a door, pipe, painting or warp zone is unlocked for this save, using the World tab's locks; any other object is removed), lock a door,
  spawn objects, start an object's motion (a motion whose trigger is "event"), give a star (it appears in front of Mario or at its spot), coins, lives, health, a cap, give or take the [shotgun](shotgun.md) or the [katana](katana.md),
  play music (the game's or a song from the sound studio) or a sound, a cutscene, shake the screen,
  warp Mario to a level or one of its areas (coming out of a door, pipe or arrival point there, or at a spot), move Mario, start/stop the HUD timer, wait, If…then…else, turn
  another event on/off, finish the level, play the ending and credits.
- *Happens*: once per save (default), once per level visit, or every time; optionally only in one
  level. **Test now** runs the actions right away.

Variables are **flags** (yes/no) and **counters** (numbers). The sidebar shows their value in this
save (click to change it while testing), the latest happenings, and **Reset** to forget the progress.

**Zones** are see-through boxes placed in build mode (Logic tab → Zone) and sized with the normal
handles; they are invisible while playing. The zone's inspector names it, lists its events and makes a
"show a dialog here" event in one click. **Hidden until an event shows it** (inspector checkbox) keeps
any object (a star to give, a bridge that appears) out of the game until a *show* or *give star*
action. Pickers in events have a target button: pick the zone or object in the level.

**Cutscenes** are lists of steps: camera shots (position + focus, glide time, easing: smooth, linear,
in, out, cut), back to the game camera, dialog lines, captions, waits, fades, moving an object, placing
Mario, and any event action. Fly the build-mode camera to a view and press **Add shot from this view**
(or **Set from current view** on a shot, **View** to look through it). The timeline strip shows the
order and length. Mario freezes while it plays, the HUD hides (optional) and **Start skips** it
(optional). **Preview** plays it in the game.

**Game texts.** All 170 of the game's dialogs (search; dialog 20 is Peach's letter), course names
(star select, pause, file select, course complete), the 6 star names of every course, Peach's lines in
the ending and the 20 credits pages (title 1–2 lines, up to 3 names; that font has capital letters,
dots and the digits 3, 4, 6). **Restore** brings an original back.

**Start & end.** At the top, the *Launch screen* card opens the [Title screen](title-screen.md) editor (splash screens, logo, title, file select, shown before the hack starts). The start level (original or custom), Mario's spot, its star select screen, the
game's own opening (Peach's letter with your text, Lakitu and the pipe; castle grounds), an opening
dialog and an opening cutscene (without a start level here, the World tab's start is used). **Play from start** (panel header,
and the World tab's button) plays the hack like a new player with a fresh save: the game's save file, the stars, keys
and opened doors of your levels and the story progress all start over (the F3 panel's *Reset save file* does the same); the standalone player starts the same way when Play is pressed. The end is an event
action: *Play the ending & credits* (Peach comes out, says your lines, the credits roll with your
pages), or *Finish the level*.

## How it works

- `web/js/story/`: `text.js` (charmap from the decomp, glyph widths, wrapping, pages, the canvas
  preview), `runtime.js` (`StoryRuntime`: texts into the engine, NPC dialog choice, triggers checked
  every frame, the action queue, cutscene player, progress), `ops.js` (story edits as operations,
  shared with the server), `schema.js` (triggers/conditions/actions/steps and their wording),
  `story_ui.js` (the panel), `logic_ui.js` (Logic tab, inspector section, picking), `rpc.js` (browser
  side of Claude's tools), `index.js` (glue for the studio and the player).
- Data: `project.story = { dialogs, texts, npcs, vars, events, cutscenes, hidden, start }`
  (`server/story.js`, message `story_op`; every client gets `{type:'story'}`). Zones and characters are
  ordinary patch records (`zone: {name}` on a no-collision block; characters are catalog objects or
  `bhvStudioNpc` with a model), so undo, copy and the world tools treat them like any object.
- Progress (flags, counters, finished events, shown/removed objects) is kept per project and save file
  in the browser's localStorage (`studio64.story.<project>.f<file>`), like studio stars, and is part
  of the project's save that the studio mirrors to the server (`web/js/savegame.js`); it survives
  deaths, level changes and reloads. Hidden objects are skipped at spawn time (a wrapper around
  `Engine._spawnRecord`), so they stay gone after re-entering a level.
- Engine (`engine/src/studio/story.c`): replaced/project dialogs (ids 256+; `studio_dialog_entry` used
  by `ingame_menu.c`), course/act/ending/credits tables, `studio_dialog_redirect` in every
  `create_dialog_box*` (the talking object's uid → `Module.studioNpcDialog`), talk-end and watched
  object events (`Module.studioStoryEvent`), event dialogs (`ACT_READING_AUTOMATIC_DIALOG`, queued until
  Mario stands), the cutscene lock (`ACT_WAITING_FOR_DIALOG`; Start sets a skip flag in
  `pressed_pause` and in the story frame), rewards, HUD timer, shakes, `WARP_OP_CREDITS_START`, the
  castle intro, and `bhvStudioNpc` (any model that talks; bparams = animation set and index).
- Data from the ROM: `tools/gen_story_data.py` writes `web/data/story_texts.json` (all texts, charmap,
  widths) and `web/data/story_font.png` (the dialog font) from `engine/text`, `bin/segment2.c` and the
  textures.

## Claude's tools (server/tools/story.js)

`story_overview`, `write_dialog`, `find_game_text`, `set_game_text`, `add_npc`, `make_talk`,
`add_zone`, `add_variable`, `add_event` (names for variables, inline dialog text, levels by name),
`cutscene` (shots can be "look at X from a direction"), `set_start`, `delete_story_item`,
`test_story`, `story_progress`.

## Tests

- `node tests/scripts/story_tools.mjs`: the AI tools with a fake context (no browser).
- `tests/scripts/story_smoke.mjs`: engine API, a project dialog in the game, a Toad saying a project dialog.
- `tests/scripts/story_flow.mjs`: a whole story played: talk (conditional line, coin reward once), zone →
  dialog + flag + gate opens, a cutscene from the flag skipped with Start, the line changes, then
  reload and re-entering the level keep the progress; a reset brings the gate back.
- `tests/scripts/story_extras.mjs`: question answers, a sign, the castle opening with Peach's letter text,
  the ending and credits.
- `tests/scripts/story_ui.mjs`: screenshots of every tab, renamed course/star on the star select screen, the
  Logic tab and the zone inspector.

Run with `STUDIO_URL=http://127.0.0.1:<port>`. Headless Chrome runs the game at a few frames per
second, so the tests hold keys for 350 ms.

## Limits

- File select and pause menu strings are built into the game code (not tables) and are not editable.
- The launch screen (splash screens, your logo, title background, file select) has its own editor: [Title screen](title-screen.md) (the card at the top of Start & end).
- The credits keep the game's 20 camera flights over its levels; only their text changes.
- Story progress is part of the project's save (browser, mirrored to the server in the studio),
  not of the cartridge save.
