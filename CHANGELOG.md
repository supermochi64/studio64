# Changelog

## Unreleased

- **Import MIDI files** in the sound studio ([#9](https://github.com/supermochi64/studio64/issues/9)):
  *Import MIDI* (or drop a .mid file on the studio) lists the file's parts, each with one of the
  game's instruments picked from its General MIDI instrument (a bass gets a bass, drums on channel
  10 the drum kit) that you can change and hear. Choose the sound set, the grid (1/16, 1/32 or
  with triplets), the bars to keep and the tempo, listen to the result, then import it: it opens in
  the composer like any song. Tempos above 240 or below 40 bpm count in half or double time.
- **No more lost notes in chords.** A track with more than four notes at once dropped the rest;
  now those notes play on the sequence's spare channels (16 channels of four notes). The import
  says when a song has more notes at once than the game can sound (16, its sound effects included).
- The composer's note lengths follow the song's grid (1/32 notes and triplets on imported songs),
  its piano roll shows notes above C7 and below C2, and long songs get a narrower roll.

## 0.2.1-beta (2026-10-25)

- **Smooth play in the browser.** The game no longer spins the browser's main thread for the rest
  of every frame: the desktop frame limiter's sleep is a busy wait in the browser, so the page
  only got 30 (on slower computers 15) refreshes a second, a whole CPU core was busy, and anything
  else on the page made the game slow down. Now the engine takes about 2 ms of each 16.7 ms frame,
  the page refreshes at the screen's rate, and every game frame is shown for exactly two refreshes
  of a 60 Hz screen (before, some got one or three: a slight stutter).
- The level thumbnail taken after entering a level no longer holds up a frame.
- `node tools/perf_play.mjs` measures how smoothly play mode runs on this computer's GPU.

## 0.2.0-beta (2026-10-25)

- **No game code or data in the repository.** The engine's source (sm64ex with the decompiled
  game, its levels, models, animations and text) is no longer kept here: the setup downloads it
  once (about 10 MB, every file checked against its checksum) and adds Studio 64's own files and
  changes to it. `engine-upstream/` and `server/romexport/decomp-changes.json` hold only Studio 64's
  own lines, never the original ones. The game it builds is byte for byte the one before. The
  trailer files left the repository too (the trailer is on YouTube). See
  [Building the engine](docs/building-the-engine.md#where-the-engines-source-comes-from).
- The release ZIP is smaller: 19 MB instead of 29 MB.

## 0.1.3-beta (2026-10-24)

- **Setup on a Mac** (thanks [@mikesherov](https://github.com/mikesherov)): the game's build stopped
  with "file not found" for a level's textures. Apple's `make` (3.81, on every Mac) didn't
  understand one line of the build rules, so the textures were never made.
- **Windows launcher:** checks the Node.js download with .NET itself instead of `Get-FileHash`,
  which some Windows PowerShell setups can't load, and says when it starts Studio 64.
- The automatic setup test on GitHub passes on macOS and Linux.

## 0.1.2-beta (2026-10-24)

- **ROM export on every computer.** The base ROM that comes with Studio 64 only matched computers
  with the same object catalog as the one it was made on: one with a Super Mario Sunshine disc set
  up, its folders listed in the same order. Everywhere else the export didn't find it and set out to
  build the base ROM itself (an N64 compiler download and a long build, which fails on Windows and
  macOS). The catalog now comes out the same on every computer (the Sunshine characters last, which
  never go into a ROM anyway), so the shipped base ROM fits everyone's.
- The automatic setup test on GitHub (Windows, macOS, Linux) runs again: its first step, making the
  release ZIP from a fresh checkout, had always failed.

## 0.1.1-beta (2026-10-24)

- **ROM export.** ⋯ menu → *Export ROM hack…* makes a real N64 ROM that plays in emulators, and a
  `.bps` patch to upload anywhere. Your hub replaces the castle grounds, your levels take the 15
  course paintings with their own names in the menus, and changes to the original levels come
  along. The story, keys, custom enemies, moving blocks, game rules, your songs, fog, cars and
  races, Shotgun and Katana Mario, Tokyo's city life and your own sound effects all work in the
  ROM, and the story's progress is kept in the save file. Roads, fences and plants and the
  ground you sculpted in the original levels come along too. The base ROM comes with Studio 64 as a
  patch, so exports take seconds on every computer. No Nintendo files go into the patch you
  share (Sunshine characters stay in the browser). See [ROM export](docs/rom-export.md).
- **Plants on raised ground.** The nature brush plants on hills you raised like on flat ground,
  plants move with the ground when you raise or lower it under them, and flowers and grass are no
  longer dark on one side. Trees, bushes, rocks and mushrooms have no more holes: every trunk and
  pine tier missed one side, and round shapes had a dent on top (fence and lamp posts too).
- **Custom objects with Toad's model** show up (they were invisible), and a platform on a track placed in
  another level takes its track along instead of flying off to its own level.
- **Setup on macOS and Linux** (thanks [@mikesherov](https://github.com/mikesherov)): a system
  Python older than 3.10 is passed over for the setup's own (emsdk needs 3.10); the Emscripten SDK's
  clang gets the target it needs as the C preprocessor and as the assembler (Apple Silicon has no
  x86 one); the Zig download completes certificate chains Node can't complete by itself.
- **Windows setup.** The first build stopped with "The Emscripten SDK was not found" right after
  the setup had installed it: Emscripten 6 starts its tools with `emcc.exe` on Windows, not
  `emcc.bat` any more.
- **Mario's colours.** A new shirt colour no longer shows around the M on his cap: the M is drawn in
  the cap's own colour.

## 0.1.0-beta (2026-10-22)

The first public release.

- The real Super Mario 64 (sm64ex, compiled to WebAssembly) running in the browser, with every edit
  showing up live. `Tab` switches between playing and building.
- Build mode: blocks in 29 materials, about 600 of the game's objects, stairs, bridges and towers,
  move/rotate/resize handles, multi-select, copy and paste between levels, undo for everything.
- Levels and terrain: new levels from 9 templates or a heightmap, terrain brushes that also work
  in the original levels, roads, paths, fences and a nature brush.
- Stars, red coin stars, moving platforms, enemies built from behavior blocks, game rules.
- World: areas, doors, pipes, paintings, warp zones, keys and star doors, your own hub, fog,
  weather and light per area.
- Story: dialogs and talking characters, When/If/Then events and cutscenes. All of the game's
  texts can be changed.
- Title screen editor with a logo maker, a sound studio with a piano roll, and sound effects.
- Your own 3D models (glTF, OBJ, FBX), textures, skies and Mario colours.
- Super Mario Sunshine characters from your own disc.
- From Shoggoth World: cars and races, Shotgun Mario, Katana Mario and the Tokyo template.
- Play-testing tools: collision view, save states and slow motion, plus a level check that finds
  broken warps.
- Sharing: project files (`.s64hack`), version history, a playable web game, and level script C
  export for the SM64 decomp.
- A first-run setup in the browser: drop your ROM and it builds everything, with no developer tools
  needed. Launchers for Windows, macOS and Linux.
- An optional AI assistant (Claude, OpenAI, Gemini, OpenRouter, local models). Hidden when nothing
  is connected; `STUDIO_AI=off` removes it.
