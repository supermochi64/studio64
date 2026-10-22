# Changelog

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
