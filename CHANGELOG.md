# Changelog

## Unreleased

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
