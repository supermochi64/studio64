# Contributing to Studio 64

Thank you for helping! Bug reports, ideas, documentation and code are all welcome.

- [Reporting a bug](#reporting-a-bug)
- [Suggesting a feature](#suggesting-a-feature)
- [Setting up](#setting-up)
- [Ground rules](#ground-rules)
- [Making a change](#making-a-change)
- [Tests](#tests)
- [Documentation](#documentation)

## Reporting a bug

Open an issue with:

- what you did, what you expected, and what happened,
- the level and, if you can, a screenshot,
- your browser and system,
- the browser console output (`F12` → Console) if the game crashed or something failed.

Never attach a ROM, a disc image, or a playable game export.

## Suggesting a feature

Open an issue and describe what you want to make in your hack, not only the button you imagine.
That helps find the simplest way.

## Setting up

Follow [Getting started](docs/getting-started.md): `npm start`, then drop your own Super Mario 64
ROM into the page; the first-run setup builds the engine and all generated data. Then:

```sh
npm start                  # the server on http://localhost:8064 (opens the browser)
npm run serve              # the same server without the launcher (no browser, no restarts)
npm run build:engine       # after changing C code in engine/
npm run test:smoke         # a quick check that everything works (about a minute)
```

Read [Architecture](docs/architecture.md) for how the engine, the web app and the server fit
together, and [Extending Studio 64](docs/extending.md) for the plug-in points.

## Ground rules

1. **Everything works without AI.** Every feature has a manual way to do it, with the mouse and
   keyboard. An AI tool is an optional extra on top. With AI off (`STUDIO_AI=off`), nothing in
   the app may mention AI: mark AI-only elements with `data-ai` (see
   [Extending](docs/extending.md#panels-and-ai-free-wording)).
2. **No Nintendo data in the repository.** Never commit a ROM, a disc image, the engine build
   (`web/engine/`), `engine/build/`, or files extracted or converted from the games. Data the
   studio needs from the game is generated from the user's own ROM by the scripts in `tools/`.
   The Shoggoth content (Tokyo, Shotgun Mario, the cars, Katana Mario) ships, but its pieces built
   on the game's Toad and Goomba are recipes rebuilt from the ROM: refresh it only with
   `npm run shoggoth:refresh`, and keep `npm run shoggoth:check` green
   ([Building the engine](docs/building-the-engine.md#the-shoggoth-content)).
3. **Edits are records.** A user change is stored in the project and replayed when an area
   loads, so it survives reloads, deaths and level changes. Keep new features in that model
   ([Architecture](docs/architecture.md#how-edits-are-replayed)).
4. **Undo works.** Every user change is one undo step.
5. **Simple words.** UI text and docs are short and friendly; no jargon where a plain word works.
   Use the design tokens and patterns in [UI](docs/ui.md#design-system).

## Making a change

1. Fork the repository and make a branch.
2. Keep the change focused. Follow the style of the code around it (ES modules, no bundler, no
   framework; C in `engine/src/studio/` with small hooks in the game's files).
3. If you changed C code in `engine/`: `npm run build:engine`.
4. Add or update a test in `tests/suite/` and run the tests (below).
5. Update the docs page of the feature.
6. Open a pull request and fill in the template.

## Tests

```sh
npm test                   # all automated tests (headless Chrome)
npm run test:smoke         # the fast subset
npm run test:noai          # with AI off: no AI element may show
node tests/run.mjs levels  # only tests whose name contains "levels"
```

Tests need Google Chrome (`CHROME` points to it) and the engine built. How to write one:
[Testing](docs/testing.md#writing-a-test).

## Documentation

Docs live in `docs/`, one page per feature, linked from [docs/README.md](docs/README.md).
Describe the manual workflow first; mention the AI tools last, as an extra. Check every key,
path and command against the code.
