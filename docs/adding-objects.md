# Adding catalog objects

The **catalog** is the list of everything that can be placed: the Objects library in build mode,
the AI's `search_catalog`/`spawn`, and the engine's spawn table all read it. This page explains
where its entries come from and how to add one.

> Want an enemy or character **without code**? Use the custom object builder
> (Objects → My objects → *New custom object*, see [Objects](objects.md#custom-objects-enemies-and-characters-without-code)).
> This page is for adding objects to Studio 64 itself.

## Where entries come from

`tools/gen_catalog.py` builds the catalog from the decomp sources in `engine/` (it runs at the
start of every `npm run build:engine`):

1. **Every object the game places anywhere.** It reads each level's script (`OBJECT(...)`),
   macro objects and special objects, and records the behavior, the model, the model's geo
   layout or display list, the bparams seen and an example position. Models the behavior spawns
   itself are found by scanning the behavior's code and added as dependencies.
2. **Objects the game only spawns from code**: the `EXTRAS` list (caps, Koopa shell, Spiny,
   walking 1-up, recovery heart, ...).
3. **Props**: every other model a level loads becomes a static `prop:` entry (`bhvStaticObject`).
4. **Sunshine characters** from `engine/src/studio/sms/catalog.json`, written by
   `tools/sms/convert.py` ([Sunshine](sunshine.md)).

It writes two files:

| File | Used by |
|---|---|
| `engine/src/studio/gen/catalog.inc.c` | The engine: the behavior table (`gStudioBehaviors`) and the entries with their models and dependencies (`gStudioCatalog`). Every model is linked, so anything can spawn in any level. |
| `server/data/catalog.json` | The server (search, names, the AI) and the browser (`/api/catalog`): `entries` (`index`, `id`, `behavior`, `model`, `gfx`, `prop`, `levels`, `params`, `example`), `behaviors`, `levels`, `studio_level` |

Entry ids are the behavior name in snake case (`bhvGoomba` → `goomba`); when one behavior is used
with several models, the model is added (`tree:palm_tree`).

## Add an object the game only spawns from code

Add `(behavior, model)` to `EXTRAS` in `tools/gen_catalog.py`:

```python
EXTRAS = [('bhvWingCap', 'MODEL_MARIOS_WING_CAP'), ...,
          ('bhvYourBehavior', 'MODEL_YOUR_MODEL')]
```

The model must be loaded by at least one level (the script looks up its geo layout there).
Then rebuild: `npm run build:engine`.

## Add a new behavior of your own

1. Write the behavior script in `engine/data/behavior_data.c` (`const BehaviorScript bhvMyThing[] = { ... };`)
   and declare it in `engine/include/behavior_data.h`
   (`extern const BehaviorScript bhvMyThing[];`). The catalog only lists behaviors that are
   declared there and have a body. Put its C functions in `engine/src/studio/` (see
   `actor.c` or `story.c` for examples) and declare them in a header the behavior file includes.
2. To make it placeable from the library, give it an entry: add it to `EXTRAS` with a model
   (above), or for a Sunshine character add it to the manifest written by `tools/sms/convert.py`.
   A behavior without an entry can still be spawned by records that name `bhv` and `model`
   directly, which is how Studio 64's own objects (`bhvStudioBlock`, `bhvStudioNpc`,
   `bhvStudioActor`, ...) work.
3. `npm run build:engine`.

## Make it nice in the library

| What | Where |
|---|---|
| A friendly name ("Bob-omb" instead of "Bobomb") | `FRIENDLY` in `server/catalog.js` (Sunshine entries carry their own `name`) |
| Search words people use ("bomb", "ghost") | `ALIASES` in `server/catalog.js` |
| The category (Enemies, Items, ...) | `categoryOf()` in `web/js/editor_ui.js`; `POPULAR` lists the Popular tab |
| Friendly bparams choices in the inspector | `PARAM_UI` in `web/js/editor_ui.js`: `{ label, byte, options: [[value, label], ...] }`, where `byte` 0 is the highest byte of the bparams |
| The picture | `node tools/make_thumbs.mjs <id>` with the server running (writes `web/thumbs/<id>.webp`) |

## Check it

- Place it in build mode in an original level and in a custom level; play; reload.
- `tests/suite/objects.test.mjs` places a sample of catalog objects and checks that none crashes
  or falls through the level: `node tests/run.mjs objects`. See [Testing](testing.md).
- The decomp export (`tests/suite/decomp_export.test.mjs`) compiles exported objects against the
  decomp's headers, so model and behavior names must be real decomp names.
