# Cars and races

Drivable cars and races, ported from the Shoggoth World hack (New York's red sportscar and the
Drift King's race on Tokyo's Shuto expressway). They work in every level: your own levels, the
original courses, on terrain, blocks and imported models. Everything works with the mouse and
keyboard; the AI assistant has tools for it too.

- [Placing a car](#placing-a-car)
- [Driving](#driving)
- [The car's settings](#the-cars-settings)
- [Races](#races)
- [Story events](#story-events)
- [For developers](#for-developers)

## Placing a car

Build mode → **Objects** → **Vehicles**, pick a car and click in the level (`R` turns it, like any
object). The looks:

| Look | | Mario |
|---|---|---|
| Sportscar | New York's red convertible | at the wheel |
| Race car | Mario's car on the Shuto | at the wheel |
| Drift King's car | the Drift King's silver racer | at the wheel |
| Taxi, Sedan, Bus | New York's traffic | inside |
| Delivery van, Tokyo cab | the Shuto's traffic | inside |
| Kei car, Kei truck | Tokyo's tiny cars | inside |

A parked car is solid: Mario can stand on it, jump off its roof, push against it.

## Driving

Walk up to a door (either side) and press **B** (`J`; "Get in" shows over the game). Mario hops in.

| Key | Gamepad | |
|---|---|---|
| `W` or `Space` | A, stick up | throttle |
| `S` or `J` | B, stick down | brake, then reverse |
| `A` `D` | stick | steer |
| `R` | R | handbrake: a drift with tyre smoke (with the drift boost: hold it through a bend, let go) |
| `↑` | C-up | horn |
| `↓` | C-down | look back |
| `←` `→` | C-left / C-right | swing the camera round |
| `Shift` | Z | get out (the car brakes to a stop first) |

The handling is the original's arcade model: momentum with a throttle that tapers towards the top
speed, strong grip that lets go under the handbrake, steering that is quickest at mid speed, the
body sitting on the ground under its four wheels (it pitches and rolls with slopes, takes off from
ramps and crests and lands with a bump), solid walls (it slides along them; hard hits cost speed,
throw sparks and shake the camera), enemies run over (any touch is an attack), Bob-ombs set off
under the wheels. The engine sound follows the revs through three gears; tyres squeal and smoke.
The chase camera pulls back and widens with speed and never goes through a wall. A car that falls
into water or off the level goes back to where it was parked. The speedometer sits bottom right
(with the drift boost's charge under it).

**Drive it** in the inspector starts play at the wheel.

## The car's settings

Select a car in build mode; the inspector's **Car** section:

| Setting | |
|---|---|
| Look | any of the ten (the car keeps its place and settings) |
| Colour | the lacquer of the sportscar, the race car and the taxi: a swatch, any colour, or the original |
| Top speed | 40 to 260 km/h (Mario runs at 35; the sportscar does 103, the race car 130) |
| Acceleration | gentle .. punchy |
| Handling | loose .. sharp: steering rate and grip |
| Headlights | beams on the road (for night levels) |
| Radio | a game song plays while Mario drives |
| Drift boost | the race's boost in free driving too |

## Races

Objects → Vehicles → **Race (rival car)** and click where the start line is: the rival's car sits
there with its driver, and a first course (a rounded loop ahead) is drawn. The inspector's
**Race** section:

- **Course**: *Edit course* turns on the path tool (the same as for moving platforms: click adds a
  point, drag moves one, `Shift`+drag up and down, right-click deletes, `Enter` ends). Point 0 is
  the start line. *Circuit* races laps of a loop; *Sprint* goes from A to B. *Smooth curves*
  rounds the corners. *Reverse* races the other way round; *New loop* starts over.
- **Laps** (circuits), **Width** (how far off the course Mario may go before he is put back on
  it), **Traffic** (cars driving the course at a steady pace).
- **Rival**: his name, his difficulty (easy, normal, hard, expert), *keeps it close* (he eases off
  ahead and pushes when behind: close all the way, but a clean run wins), his lines.
- **Mario's car**: the car the race gives him when he comes on foot (look and colour).
- **Reward**: a star for winning, with its name. It is a star of the level: it shows on the Stars
  tab, the star screen and the counter, and collecting it finishes the level like any star.
- The rival's car itself: the **Rival car** section (look, colour, top speed). Left at the look's
  speed, he races at the same top speed as Mario's car.

**Race now** starts it from build mode. Playing: walk up to the rival and press **B** ("Race!"),
or stop beside him in a car and honk (`↑`): that car races.

The race, as in the hack: a fade onto the grid beside him, the camera sweeping round both cars, the
rival's opening line, **3, 2, 1, GO** (floor it just before GO for a *rocket start*; too early and
the engine bogs down). Then the checkpoints along the course (no cutting across), laps and lap
times, 1ST / 2ND, WRONG WAY, a fade back onto the course when off it or stuck, the **drift boost**
(hold `R` through a bend: blue sparks, then orange; let go for a flame and a kick), the
**slipstream** (tuck in behind him), shoving matches with him, traffic to weave through, his taunts.
Over the line both cars draw up, Mario gets out, the banner says who won; a win sends the star out
of the rival's car to Mario, a loss offers a rematch (B by the rival). The game's own HUD makes
room for the race's: place and lap top left, time top right, a map of the course with both cars.

## Story events

In the Story panel and the build-mode Logic tool:

| | |
|---|---|
| When: *Mario gets in or out of a car* | a car (or any), when he gets in, out, or crashes |
| When: *A race starts or ends* | a race (or any): it starts, Mario wins, Mario loses |
| If: *Mario is driving a car* | |
| Then: *Start a race* | a race starts as if Mario challenged the rival |

For example: a Toad who says "Beat my brother and I'll open the gate" (the gate opens on *Mario
wins the race*).

## For developers

| | |
|---|---|
| `engine/src/studio/vehicle.c` | the driving core (from `car_core.inc.c` and `newyork_car.c`): physics, walls, crashes, landing, engine and tyres, chase camera, getting in and out, `ACT_STUDIO_DRIVE`, the car objects |
| `engine/src/studio/vehicle_race.c` | races (from `highway.c`): the course from the record's path (`studio_motion_path`), the rival on rails, checkpoints, laps, countdown, boosts, slipstream, traffic, finish, star |
| `engine/src/studio/vehicle_models.c` | the looks, their sizes, repainting (recoloured copies of the body's vertices), headlight beams, the wheel callback |
| `engine/src/studio/vehicles/cars.inc.c` | the models, made by `tools/vehicles/extract_cars.py` from the hack's generated level data; they ship with Studio 64 (refresh: `npm run shoggoth:refresh`, [Building the engine](building-the-engine.md#the-shoggoth-content)). The Drift King at the wheel is a dressed Toad: his vanilla triangles and recoloured cap are made from your ROM at build time (`rom_recipes.json`) |
| `engine/src/studio/vehicles/catalog.json` | the library entries (`tools/gen_catalog.py` merges them) |
| `web/js/vehicles.js`, `web/css/vehicles.css` | settings to the engine, the HUD over the game, the inspector sections, RPCs |
| `server/tools/vehicles.js` | the AI's `list_vehicles`, `place_car`, `setup_race`, `edit_vehicle`, `drive` |
| `tests/suite/vehicles.test.mjs` | places a car, drives it (throttle, steering, a drift, a wall), gets out, sets up a race, wins it with the autopilot, collects the star, reloads, drives a taxi in Bob-omb Battlefield |

Hooks in the game: `mario.c` (`studio_vehicle_before_step` for B at a door, `ACT_STUDIO_DRIVE`
dispatch), `camera.c` (`studio_vehicle_camera` in `update_graph_node_camera`).

Records: cars are `{ entry: 'vehicle:<look>', vehicle: { look, top (km/h), accel, handling,
color, lights, boost, radio } }`; a race is `{ entry: 'vehicle:race', vehicle: {...the rival's
car}, race: { laps, difficulty, width, rival, player: { look, color }, traffic, rubber, lines },
star: { name }, motion: { path: { points, mode: 'loop' | 'once', smooth } } }`. The page passes
them with `studio_vehicle_config` and `studio_race_config`; `studio_vehicle_hud` returns the
floats the HUD draws (also handy in tests), `studio_vehicle_state_json` the car Mario drives,
`studio_vehicle_enter(uid)` / `studio_race_start(uid)` get in or race, `studio_race_autopilot(1)`
drives the course flat out (tests). In the page: `window.studio64Vehicles` (`driving()`,
`state()`, `hud()`, `enter(uid)`, `exit()`, `startRace(uid)`, `endRace()`), and `studio:vehicle`
window events (`{ kind: 'vehicle' | 'race', event | result, uid }`).

Differences from the hack: no code overlays (resident code, one car driven at a time, any number
parked); the New York car's owner Goomba, the hood warp and the pedestrians' hops are the hack's
story and not ported; the race's start and end dialogs are on-screen lines (the story can add
dialogs on the race events); the speedometer and race HUD are drawn by the page in the hack's
style instead of its N64 HUD kit.
