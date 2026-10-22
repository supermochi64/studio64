# Testing Studio 64

## Running the tests

```sh
npm test                 # every automated test (not the ones that need a Claude login)
npm run test:smoke       # the fast subset (tests tagged smoke): about a minute
npm run test:ai          # tests that send real chat messages to Claude (costs a little usage)
npm run test:all         # everything, including the AI tests
npm run test:noai        # no AI connected: own server with STUDIO_AI=off, smoke tests + no_ai
node tests/run.mjs levels terrain   # only tests whose file name contains "levels" or "terrain"
node tests/run.mjs -j 2             # 2 tests at a time (default 3, or 1 when the machine is busy; TEST_JOBS)
node tests/run.mjs --list           # the tests, their tags and what they cover
```

```
tests/run.mjs       the runner
tests/suite/        the tests (*.test.mjs), one file per feature
tests/scripts/      older plain-script tests the runner also runs
tests/lib/          the shared harness, the fake LLM and helpers
tests/setup/        the first-run setup on clean Linux images (not part of npm test)
tests/fixtures/     small models and pictures the tests import
```

The runner starts its own server on a free port with an empty projects folder
(`tests/out/projects`), so a test run never touches your projects. To test against a server
that is already running, set `STUDIO_URL`:

```sh
STUDIO_URL=http://127.0.0.1:8078 npm test
STUDIO_URL=http://127.0.0.1:8078 node tests/suite/levels.test.mjs   # one test file directly
```

Needs Chrome, Chromium or Edge (found where it is installed, `tools/lib/browser.mjs`; or set
`CHROME`) and the engine built (the first-run setup, or `npm run build:engine`). Tests run headless with SwiftShader (software WebGL); `HEADFUL=1`
shows the browser.

The runner prints a line per test as it finishes, then a summary table, and exits non-zero
when a test fails. Each test's full output is in `tests/out/logs/<test>.log`, screenshots in
`tests/out/<test>/`, and a failed test also leaves `final.png` and the page's console there.
`tests/out/results.json` has the last run's results. `tests/out/` is not checked in.

### On a small or busy machine

Every test runs its own headless Chrome with software WebGL (SwiftShader); one takes roughly
1-1.5 GB of memory and a few cores. On an 18 GB machine that also runs other apps, use
`TEST_JOBS=1 npm test` (the runner already drops to one test at a time when the load average is
above the number of cores). A starved page draws almost no frames; the harness then reports
`stalled boot: animation frames in 2 s: N` and loads the page again (twice at most). Tests wait on
conditions and frame counts, not on wall-clock time, so a slow machine makes them slower, not red.
Frame-exact checks freeze the game and step it (`_studio_debug_speed(1, 1)`, `_studio_debug_step(n)`,
the Test panel's frame advance), see `shotgun.test.mjs`.

## The setup on clean systems

The first-run setup (launchers, downloads, the browser wizard) is tested apart from `npm test`, on
systems that have none of the developer tools:

```sh
node tools/make_release_zip.mjs                        # dist/studio64-<version>.zip
node tests/setup/sandbox.mjs prepare ubuntu-24.04      # downloads an image (images.linuxcontainers.org)
node tests/setup/sandbox.mjs run ubuntu-24.04 --wrong-rom --second --offline --shots out/
```

`sandbox.mjs` runs a clean Linux image (Ubuntu 22.04 and 24.04, Debian 12, Fedora 43/44, Arch)
with `bwrap` in user namespaces: no root, the image read-only, a fresh home folder. It unpacks the
release ZIP into that home (`--parent "Spiele für Jörg"` for a path with spaces and accents),
starts `start-studio64.sh` there as a double-click would, and drives the wizard with Playwright
from this machine (`tests/setup/wizard.mjs`): the setup page, a changed ROM and a text file refused
(`--wrong-rom`), the ROM dropped through the file input (`--order v64`/`n64` converts it first),
**Build**, until the studio opens by itself. Then `tests/setup/studio_check.test.mjs` places a
Goomba from the library with the mouse and plays. Options: `--interrupt` stops the whole sandbox
in the middle of the build and continues it after a new start, `--second` starts it again (no
setup, nothing downloaded, fast), `--offline` starts it with no network at all, `--hide curl`
removes programs the launcher could use. Each run downloads about 600 MB and takes 10–20
minutes; the sandbox may use 7 GB of memory (a systemd scope; an engine link needs ~4.6 GB), so
run one at a time on a small machine. Reports land in `~/s64-setup-test/reports/`.

For Windows and macOS, `.github/workflows/setup.yml` does the same on GitHub's fresh
`windows-2022`, `macos-14` and `ubuntu-24.04` machines (the launcher, the wizard, an object
placed, a second start), with the ROM from a repository secret (see the file).

## Writing a test

A test is `tests/suite/<name>.test.mjs`: a plain node script using `tests/lib/harness.mjs`.

```js
// What the test covers, in one line (shown by --list).
// @tags editor smoke        (smoke: in the fast subset; ai: needs Claude; manual: never run by npm test;
//                           noai: only in test:noai; chat: needs the chat panel, left out of test:noai)
// @timeout 600             (seconds, default 420)
import { suite } from '../lib/harness.mjs';

await suite('my feature', async (t) => {
  const s = await t.open({ level: 9 });      // a new project in a new browser page, game booted
  await s.build();                           // build mode
  t.check('something true', cond, detailIfFalse);  // soft check: the test goes on
  t.eq('a value', got, want);
  t.near('a number', got, want, tolerance);
  t.must('needed for the rest', cond);       // ends the test when false
});
```

- Every test makes its own project (`t.open()`), so tests can run in parallel.
- Page errors, `console.error` lines, failed requests and engine crashes fail the test
  automatically. Allow expected noise with `t.allowConsole(/pattern/)`.
- The session `s` has helpers: `s.eval(fn, arg)`, `s.state()`, `s.mario()`, `s.records()`
  (patch records of the current area), `s.changes()`, `s.export()` (the project from the
  server), `s.build()` / `s.play()`, `s.newLevel(template, name)`, `s.goLevel(num)`,
  `s.goCustom(id)`, `s.skipIntro()`, `s.arrive(level)`, `s.viewMario(dist, pitch)` (build-mode
  camera looking down at Mario), `s.lookAtWall()`, `s.groundPoint()` (a screen point on the
  ground), `s.clickAt(x, y)` / `s.drag(...)` (mouse on the game, overlay coordinates),
  `s.framesAdvance()`, `s.crashed()`, `s.shot(name)`, `s.reload()`.
- A second tab on the same project: `t.open({ project: s.projectId, context: await t.browser.newContext() })`.
- Use the real UI where the user would (clicks, keys); use `studio64.*` from the page to read
  state and to set up what is not being tested.

## What the suite covers

| Test | Covers |
|---|---|
| boot | the app loads, the game runs, Mario walks and jumps, main UI, catalog |
| build_basics | build mode with the mouse: place a block, select, inspector (position, size, shape, material), R, Ctrl+D, Delete, Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y redo, toolbar undo/redo, G, Esc, collision in play mode, reload |
| structures | every Builds generator: preview, typing parameters (focus kept, sane ranges), build, collision, undo |
| objects | a sample of ~90 catalog objects placed with the editor in BoB and in a custom level: spawn, crash, falling through the level |
| levels | launcher (Ctrl+K, search, card jump, pictures), a new level from every template, rename, duplicate, delete (also the current one), reopening the last level after a reload |
| terrain | every brush in a custom level (collision follows, one edit per stroke, undo), brush size keys, reload; sculpting BoB, replay after reload, undo |
| stars | a star from the Stars tab, rename, collect (course complete, counter), red coin star with 8 coins, 100 coin star, progress after reload |
| sound | sound studio: open/close (button, M, Esc), starter song, piano roll, play/stop, tempo, use as level music, replacing the coin sound (it really plays), persistence, deleting the song, game music |
| multitab | two tabs on one project: viewers, edits, moves, deletes, undo, rename, new levels reach the other tab |
| chat_ui | the chat panel without Claude: send button state, suggestions, attachments, model menu, Esc/`/` focus, edits/stars tabs, menus |
| mobile | phone-size layout: no horizontal scroll, game visible, panels reachable |
| shortcuts | keyboard shortcuts in play and build mode, and that typing in fields never moves Mario or triggers them |
| session | a long session: many level jumps and edits; JS heap and wasm memory stay bounded, no errors |
| chat_ai (ai) | one short real chat message: Claude answers and an edit arrives |
| server | the server without a browser: projects API, websocket welcome/edits/undo/redo, levels, rename, clearing all edits keeps your own levels, export |
| course | custom levels as courses: pause (Start once the entry transition is over), Exit Course, falling to death (a life less, full health), BoB pause, build mode after pause |
| screens | every main screen: no overflowing text, nothing outside the window, no broken images; a picture of each in tests/out/screens/ |
| edge_cases | clicking Mario in build mode, Tab on the star screen, two level jumps in a row, jumping from build mode, placement at the world edge, deleting every original object nearby and undoing it |
| server_security | the server under abuse, no browser: requests from other websites, DNS rebinding, the password (header, cookie, websocket), malformed and huge requests, path traversal, hostile project files, links to missing projects |
| history_size | 200 terrain strokes keep the project file small; undo/redo exact, a second tab follows, export and versions |
| ui_polish | the app around the game with the keyboard: home screen dialogs and menus, Esc everywhere, missing projects, the password in the browser, loading errors, offline queue, auto-saves |
| leave_saves | edits made just before a reload (story text, title screen) reach the server |
| no_ai (noai) | with STUDIO_AI=off: no AI element visible or taking space, the game fills the room, editor/levels/sound work |
| custom_objects | Custom objects without code: make one in the builder (UI), place it, get hurt by a chaser, defeat a stompable one by jumping on it (coins + "defeated" event), a punch-only one hurts when stomped, a turret shoots, a patroller walks its path, edits change… |
| decomp_export | Decomp export: edits of original levels become level script C (OBJECT / WARP_NODE) that compiles against the decomp's headers (engine/include), with notes for what it cannot hold. |
| game_rules | Game rules: the Game panel changes Mario's jump height (measured), gravity, run speed, switches moves off (long jump), fall damage; per-level overrides win over the game's rules; the rules are saved in the project and come back after a reload. |
| gaps_assets | Imported models free their memory when they are rebuilt or deleted (no growth on re-import), and the area's light (World tab → Light) shades blocks and imported models, not only terrain. |
| gaps_paths | Objects gaps: undoing a custom object's definition keeps its copies working (also after a reload); a level's own platform on a track takes a redrawn track at once (and its own one back); Koopa the Quick runs the race path drawn for him. |
| gaps_world | World gaps: a door flat against a wall (Mario stops in the doorway instead of walking into the wall, and comes out of a door on its open side), a cannon Mario climbs into and is shot out of, and a painting with an uploaded picture (shown, kept after a… |
| motion | Motion: blocks that move along paths, elevators, spinning, falling, conveyor, trampoline and blinking platforms; Mario rides them (platform displacement), collision moves along; build mode puts them back home; motions survive a reload. |
| objects_ai | Claude's object tools (server/tools/objects.js) end to end: the real tool handlers of a real Agent, their rpc calls answered by a real game in the browser, their changes stored in a real project. Covers attach_motion, create/edit/place custom objects,… |
| objects_ui | Build mode UI for objects: the Motion section and the path tool (click to add points, drag them), the scene panel (list, shift-click multi-select, box-select, align as one undo step, hide/lock, rename), prefabs (save, place), copy & paste, group delete + undo. |
| projects_home | Projects: the home screen (list, search, templates), a hack from scratch, project settings, versions (save, compare, restore), export -> drag & drop import roundtrip with an asset file, duplicate, delete with in-app confirmation + undo. |
| robustness | Robustness: edits made while the connection is down are kept and saved when it comes back (also across a reload), level operations undo and redo, and a crashed engine shows a friendly recovery card that restarts the game (in the castle when asked). |
| samples | The sample hacks of the home screen: each opens in its own level and the level check finds no errors. |
| shell | The studio shell: the workspace rail (every workspace button, one current at a time, switching closes the open one), the command palette (Ctrl+P, search, run, hand the words to Claude), the shortcut sheet (?), the chat toggle (Ctrl+J), dialogs instead of… |
| shotgun | Shotgun Mario (from the Shoggoth World hack): the Shoggoth library tab, placing the pickup with the mouse, picking it up (how-to card), B fires every 26 frames with no recoil, the pump, wall holes and effects, the shotgun jump, aim mode with its crosshair,… |
| standalone | Standalone export: the playable .zip of a hack (a sample with its own level) unpacked and served by a plain static file server plays in the browser: title card, game, level list, no errors. |
| testing_tools | Play-testing tools: debug overlay (collision, hitboxes, Mario info, FPS, timer), frame advance, save states, the save file, the level validator with planted problems (Show, Fix), play from here. |
| tokyo_template | Tokyo from Shoggoth World as a level template: the New level card, the city (geometry, collision, water, sky, music, scenery, traffic, yokai), its stars, walking its streets, riding a lift, editing it and getting it back after a reload.… |
| katana | Katana Mario (the Shoggoth World hack's maid café): the Shoggoth library tab, the Legendary Blade (the pull, the how-to card), the combo, spin, dash and lunge frame-exact, a Goomba cut down, a fighter defeated, a duel lost and won (star, story), the rule (one weapon), reload, the project file and the standalone player |
| shoggoth_content | the shipped Shoggoth content holds none of the game's data (`npm run shoggoth:check`) and its recipes build from this ROM; no browser |
| vehicles | Vehicles (the Shoggoth World hack's car and race): place a car from the library, the inspector, get in with B at the door, drive (throttle, steering, a drift), hit a wall, get out; a race along a drawn course against the rival, won with the autopilot, its… |
| subareas | sub-areas (c:&lt;id&gt;:&lt;n&gt;) in every consumer: star screen, pause pages, level cards, collecting, validator, edit list, scene panel, custom objects and models in them, duplicating, project file, player data |
| integration_story | story ↔ world ↔ objects played: an event locks a sub-area door and a zone opens it, walking in fires "enters an area", a custom object spots Mario (starts a platform's motion) and hurts him (warp out of a door), the save per project mirrored to the server (survives cleared storage), F3 reset and Play from start reset the story |
| showcase | the Showcase hack (every feature) built, checked, exported as .s64hack, imported and played in the player: opening cutscene, Toad, star door, elevator, star, sub-area cutscene and song, painting to a level with its own rules, patrolling enemy and its hidden star |
| undo_all | Ctrl+Z / Ctrl+Shift+Z for story, Mario's colours, textures (files back from the trash), skies, world flow, environment, game rules, songs; area delete undone; a version restore brings everything back |
| title_screen | the launch screen: editor (logo maker, upload, styles, drag, backgrounds, splash screens, file select, undo), Play from start through it, the game's title with and without Mario's face, a level fly-over, reload, home card cover, .s64hack round trip, the standalone player |
| paths | roads and nature: a road and a fence drawn with the mouse, Mario walks the road, climbs a walk's steps and is blocked by the fence, a junction, editing points and width, painting and erasing plants, undo, reload, the player and the playable export |
| gameplay | bugs found by playing: a trampoline catches long falls, a switched-off wall kick gives no boost, "star collected" events show their dialog / cutscene after the level exit, a full object pool keeps the game running, a save state from a cutscene, the player's L and Enter keys |
| editing_polish | the editing tools' hidden bugs: odd inspector values (empty, huge, NaN), group undo, focus after build-bar controls and dialogs, typing while the object changes elsewhere, damaged model files, star copies, double-sided imported walls, stuck screen fades, the build overlay in play mode |
| assets | OBJ/GLB/FBX import with preview, props and level geometry (collision, walking on it), library, inspector, model settings, game textures (replace, pixel editor), custom materials on blocks, Mario's colours, skies, a level made from a model, reload |

Other suites in `tests/suite/` come with their features (motion, custom objects, ...).

The older plain scripts in `tests/scripts/` run with the suite too (listed in `SCRIPTS` in
`tests/run.mjs`): `story_tools`, `story_smoke`, `story_flow`, `story_extras`, `story_ui` (the
story features), `world_tools`, `world_doors`, `world_flow`, `world_env`, `world_ui`,
`world_look` (areas, doors, hubs, environment; helpers in `tests/lib/world_lib.mjs`),
`sunshine_tools`, `sunshine_library`, `sunshine_enemies`, `sunshine_talk`, `sunshine_shine`
(the Super Mario Sunshine characters) and `ai_loop`, `ai_providers` (the assistant loop and
"connect any LLM" against a scripted fake LLM, `tests/lib/mock_llm.mjs`, which the runner starts
on a free port; no real AI usage). They pass by exit code, and their `PASS`/`FAIL` lines count as
checks.
