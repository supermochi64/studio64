# Studio 64 documentation

How to make Super Mario 64 hacks in Studio 64, from your first platform to adding your own engine
features. The guides describe doing things by hand. The AI assistant is optional and has
[its own page](ai-providers.md).

## Start here

| | |
|---|---|
| [Getting started](getting-started.md) | Install (`npm start`, drop your ROM), the first-run setup, Windows and Docker, and your first hack in 5 minutes |
| [FAQ](faq.md) | ROMs, sharing, AI, systems, where projects live |
| [Keyboard shortcuts](keyboard-shortcuts.md) | Every key on one page |
| [Glossary](glossary.md) | SM64 and Studio 64 words: areas, acts, bparams, warp nodes, ... |
| [Troubleshooting](troubleshooting.md) | When something does not work |
| [Settings](settings.md) | Server options (port, password, storage, AI) |

## Making a hack

| | |
|---|---|
| [The interface](ui.md) | Workspaces, command palette, layout |
| [Build mode](build-mode.md) | The mouse editor: camera, library, handles, inspector |
| [Levels and terrain](levels-and-terrain.md) | The level launcher, new levels, templates, terrain brushes, level settings |
| [Tokyo template](tokyo-template.md) | Shoggoth World's Tokyo as a level to start from: what comes with it, how it is made |
| [Roads and nature](roads-and-nature.md) | Roads, walks, junctions and steps; fences, walls, lamps; the brush for trees, flowers, grass and rocks |
| [Stars](stars.md) | Your own stars, red coin stars, the 100-coin star |
| [Objects](objects.md) | Moving platforms and paths, custom enemies without code, the scene panel, prefabs, game rules |
| [World](world.md) | Areas, doors, pipes, paintings, warp zones, the hub, fog, weather, camera |
| [Story](story.md) | Dialogs, characters that talk, events (When → If → Then), cutscenes, game texts |
| [ROM export](rom-export.md) | Your hack as a real N64 ROM and a .bps patch to upload anywhere: where your levels go, what comes along |
| [Title screen](title-screen.md) | Your hack's launch screen: logo maker, background, Press Start, music, splash screens, file select |
| [Assets](assets.md) | Your own 3D models, textures, materials, skies, Mario's colours |
| [Sunshine characters](sunshine.md) | Piantas, Nokis and more from your own Super Mario Sunshine disc |
| [Shotgun Mario](shotgun.md) | The shotgun from Shoggoth World: pickup, firing, aim mode, how every enemy reacts, gangsters |
| [Katana Mario](katana.md) | The Legendary Blade from Shoggoth World's maid café: the pull, the combo, spin, dash and lunge; the cosplayer fighters; the katana duel |
| [Cars and races](vehicles.md) | Drivable cars from Shoggoth World: getting in and out, driving, looks and tuning; races along a course you draw, rivals, laps, the star |
| [Sound studio](sound-studio.md) | Compose music, make and replace sound effects |
| [Play-testing tools](testing-tools.md) | Debug view, save states, slow motion, speedrun timer, save file, level check |
| [Projects](projects.md) | Home screen, versions, project files, the playable game, decomp export |

## The AI assistant (optional)

| | |
|---|---|
| [AI providers](ai-providers.md) | Claude, OpenAI, Gemini, OpenRouter, local models (Ollama, LM Studio, llama.cpp), or no AI at all |

## For developers

| | |
|---|---|
| [Architecture](architecture.md) | Engine, web app and server; how edits are stored, synced and replayed |
| [Building the engine](building-the-engine.md) | What the first-run setup does, building by hand, generated data, platforms |
| [Extending Studio 64](extending.md) | AI tool plug-ins, `registerRpc`, route plug-ins, palette commands |
| [Adding catalog objects](adding-objects.md) | Where the object library comes from and how to add to it |
| [Testing](testing.md) | Running the test suite and writing tests |
| [Interface design system](ui.md#design-system) | Tokens, patterns, adding a panel |
| [Contributing](../CONTRIBUTING.md) | How to send a change |
| [Changelog](../CHANGELOG.md) | What changed in each release |
