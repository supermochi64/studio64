# Sunshine characters

The object library has a **Sunshine** tab with characters from *Super Mario Sunshine*: the
islanders of Isle Delfino and the most iconic enemies, with their own models, textures,
animations and blinking eyes, converted from your own Sunshine disc. Their behavior is rebuilt
for SM64, so they play like SM64 objects: stompable, punchable, coins, puffs of smoke, SM64
sounds.

## The cast

| Character | What it does | Controls in the inspector |
|---|---|---|
| **Pianta** (man, man in a tank top, woman) | Strolls around its spot, turns to Mario, talks when he presses B and cheers afterwards, gets mad and stomps when he hits it. Every Pianta picks its skin colour and Hawaiian shirt from where it stands, so a crowd is colourful by itself. | Does: strolls / stands / dances |
| **Noki** (man, woman) | The people of Noki Bay: shells and hats in five colours, their own lines, same manners as the Piantas. | Does: strolls / stands / dances |
| **Shine Sprite** | A star with Sunshine's look: collecting it counts and ends the level exactly like a star. Place it from the **Stars** tab (*Shine Sprite*) to give it a name. | |
| **Strollin' Stu** | Wanders, spots Mario (a little hop of surprise) and charges to bump him. Stomp it flat or punch it: a coin. | Does: wanders / guards; Size: normal / big / small |
| **Swoopin' Stu** | A translucent blob of goop with a ball of goop inside, in seven colours. Crawls, chases Mario, flashes white with a cry and lunges, bursting on him. Stomp or punch pops it. | Does: crawls / waits; Colour |
| **Electrokoopa** | Roams, turns to Mario and throws its crackling electric shell. While it wears a shell, touching or stomping it shocks Mario; after the throw it is defenceless for a few seconds until it grows a new shell: stomp or punch it then (2 coins). | Does: roams / stands guard |
| **Pokey** | Sways, turns to Mario and lunges its head at him. Every stomp or punch knocks a segment off (it sinks a step and drops a coin); hit the head when nothing is left below it and it falls apart (3 coins). | Segments: 3 / 2 / 1 |
| **Cataquack** | Waddles around or naps, then dashes at Mario. A **blue** one scoops him up and tosses him high into the air without hurting him (a living launcher: put one below a ledge); a **red** one rams him. Stomp it to defeat it; a punch flips it over for a while. | Kind: blue / red; Does: waddles / sleeps |
| **Blooper** | Sunshine's land Blooper: patrols, searches, runs at Mario, punches him and spits goop from a distance. A stomp makes it numb for a few seconds; stomp or punch it again while it is numb (3 coins). | Does: patrols / stands guard |

Place them like any object (build mode, **Objects**, tab **Sunshine**), move, turn, scale and
duplicate them; every change is saved in the project.

## With Claude

Claude knows the cast and its parameters. Ask for single characters ("put a red Cataquack by
the bridge", "three Pokeys along the path") or for a ready-made group with the
`sunshine_group` tool: a Pianta **plaza**, a **Noki village**, a **dance party**, a **goop
patrol** (Strollin' and Swoopin' Stus), a **goop ambush**, an **electro squad**, a **Pokey
garden**, a **launcher** (one blue Cataquack below a ledge), **red quacks**, a **harbor** of
Bloopers, or a **boss rush** (one of each). `sunshine_characters` lists everything with its
behavior parameters.

## Getting the characters

The models are not in this repository. They are converted from your own *Super Mario Sunshine*
disc image (USA, `GMSE01`, `.iso`, `.gcm` or `.nkit.iso`). The easy way: drop the disc into the
first-run setup page, or later open the **Sunshine** category of the object library and press
**Add the Sunshine characters** (`/setup.html?add=sunshine`). The setup converts them (in a
Python environment with numpy and Pillow that it makes in `.setup/python`), rebuilds the game and
takes their library pictures. Compressed images (RVZ, GCZ, WIA, CISO) must be converted to ISO in
Dolphin first (right-click the game → *Convert File…*).

Without a disc, the engine builds with a stand-in (`engine/src/studio/sms/stub/`): no Sunshine
objects in the library, no Shine Sprite button, and no Pianta characters in the story panel.

By hand:

```sh
pip install -r tools/requirements.txt                       # numpy + Pillow
SMS_ISO=path/to/sunshine.iso python3 tools/sms/convert.py
npm run build:engine
node tools/make_thumbs.mjs sms:pianta sms:noki ...          # library pictures (server running)
```

## How the conversion works

`tools/sms/` reads the disc and the J3D formats and writes `engine/src/studio/sms/gen/`
(`sms_data.inc.c`, `sms_bodies.h`) plus the library manifest `engine/src/studio/sms/catalog.json`,
which `tools/gen_catalog.py` merges into the catalog (ids `sms:*`).

| File | |
|---|---|
| `gcm.py`, `nintendo.py` | GameCube disc (GCM file table), Yaz0, RARC archives |
| `j3d.py` | BMD/BDL models (skeleton, envelopes, vertex arrays, shapes, full MAT3 materials with their TEV programs), BMT material tables, BTI textures, BCK joint animations |
| `character.py` | **one pipeline for any J3D character** (below) |
| `convert.py` | the cast: where each character's files are on the disc, its scale, animation list and material overrides; the catalog entries |
| `preview.py` | software renderers: the raw model, and the converted data exactly as the engine poses and lights it (`render_character_px`), for checking a conversion without building |

The pipeline (`Character(spec)`):

- **Smooth skinning.** Every vertex keeps up to four joint influences (J3D envelopes), each with
  its position and normal in that joint's bind space (EVP1 inverse bind matrices). The engine
  poses the skeleton every frame and blends the influences on the CPU, so shoulders, hips and
  skirts bend without gaps, like in the original. Vertices are batched in loads of up to 64.
- **Animations.** All of J3D's channels per joint: scale (as half floats, some locators are
  scaled 60x), X-Y-Z rotation and translation, with segment scale compensation. Constant
  channels are stored once, animated ones every other frame (the engine interpolates). Joints
  that carry no vertices stay still. They are SM64 `Animation`s, so behaviors use
  `cur_obj_init_animation`, loops and `animFrame` as usual.
- **Looks from the TEV.** Each material's TEV program is evaluated: its main texture is baked
  through the stages in full light, and for every vertex colour the converter tabulates the
  colour at five light levels (including the game's toon ramp texture, which TEV looks up with
  the lit colour). At runtime the skinned normal's light level picks from that ramp, so the
  characters keep Sunshine's two-tone shading. Pollution masks count as clean.
- **Textures** are RGBA16, IA16 for greyscale and RGBA32 for soft alpha, up to 64x64 (loaded
  whole: the engine raised gfx_pc's 2048-texel import buffers to 4096).
- **Draw layers.** Opaque, cut-out (alpha test), translucent and translucent decals (eyes drawn
  onto the face); back-face culling from the material, clamp/mirror wrap from the texture,
  sphere mapping for materials whose texture coordinates come from the normals (the Shine).
- **Material overrides** per character: texture frames chosen by the object (`slot` 1 = eyes,
  blinking; 2 = shirt or shell colour), `tint` (the object's colour multiplied in, grey parts
  only: a Pianta's skin, not its leaves), flat `color`, `layer`, `skip`.
- **Attachments**: other models carried rigidly by a joint (a Swoopin' Stu's goop ball, a Noki's
  shell and hat), with their own material tables.

The engine side (`engine/src/studio/sms/`):

| File | |
|---|---|
| `sms_models.c` | `geo_sms_skin`: poses, skins, lights and draws a body (one GEO_ASM per draw layer) |
| `sms_common.c` | shared behavior helpers: bodies, animations, SM64-style hits, deaths with coins, squashing, wandering |
| `pianta.c` | Piantas and Nokis (talk through a borrowed dialog slot) |
| `strollin_stu.c`, `swoopin_stu.c`, `electrokoopa.c`, `pokey.c`, `cataquack.c`, `blooper.c`, `shine.c` | the behaviors |
| `sms_behaviors.c` | their behavior scripts (`bhvSms*`) |

### Adding a character

1. Find its files: `python3 tools/sms/gcm.py <iso> scene/` lists the scene archives
   (`data/scene/*.szs`); each holds one folder per actor (`hamukuri`, `poihana`, ...), listed
   with `convert.Disc(iso).scene('bianco0').keys()`.
2. Add a spec function to `convert.py` (model, optional BMT, scale, animation names, overrides)
   and a catalog entry; check it with `preview.render_character_px`.
3. Write the behavior in `engine/src/studio/sms/` with the helpers of `sms_common.c`, add its
   script to `sms_behaviors.c` and its declarations to `sms.h`.
4. Convert, build, add a note for Claude in `server/catalog.js` (NOTES) and inspector controls
   in `web/js/editor_ui.js` (PARAM_UI), render the thumbnail.

## Tests

| Test | |
|---|---|
| `tests/scripts/sunshine_talk.mjs` | B talks to a Pianta and a Noki, A closes the dialog, talking again never freezes Mario |
| `tests/scripts/sunshine_enemies.mjs [looks\|play]` | close-ups of every enemy; each notices Mario and reacts to a stomp |
| `tests/scripts/sunshine_shine.mjs` | a Shine Sprite is collected like a star |
| `tests/scripts/sunshine_library.mjs` | the Sunshine tab lists everything with thumbnails; the inspector's controls are saved |
| `tests/scripts/sunshine_tools.mjs` | Claude's `sunshine_characters` / `sunshine_group` tools (no browser) |
