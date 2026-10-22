# Title screen: your hack's launch screen

What players see when your hack starts, before the first level: splash screens ("made with
Studio 64", your own logo), the **title** with your logo, "Press Start" and music, and a
**file select**. It plays in the studio's **Play from start** and in the playable game you
export, exactly the same. Everything works with the mouse; the AI assistant can do it too.

![The title screen editor](img/title-screen.png)

## Opening it

- **Story → Start & end**: the *Launch screen* card at the top, then **Make a title screen**
  (or **Edit title screen**).
- The command palette (`Ctrl+P`): *Title screen*, or *Preview the title screen*.

The editor docks into the stage like the Story panel. The big picture on the left is a **live
preview** (it animates); the strip under it shows the order players see:
*splash screens › Title › File select › the game starts*. Click a step to edit it.

**Use it** (the switch at the top) turns the launch screen on. While it is off, the hack starts
right away, like before. **Preview in the game** plays it in the real game (with the real
background, Mario's face and the music) and brings you back to where Mario was afterwards.

Every change is saved by itself and is **one undo step** (`Ctrl+Z` in the editor, or the Edits
list: *Changed the title screen logo*, *Added a splash screen*, ...).

## Logo

Shown in place of the game's "SUPER MARIO 64" logo.

- **Logo maker**: type the main line and a second line (like "64"), pick a **style**
  (Super 64, Gold, Spooky, Ice, Lava, Retro, Neon, Forest), then change anything:
  - font (Lilita One, Luckiest Guy, Titan One, Bungee, Fredoka, Bangers, Creepster,
    Press Start 2P, ...),
  - colours: *colourful letters* (each letter its own colour, like the game's logo), a
    *gradient* or *one colour*; the second line has its own two colours; a *shine* on top,
  - outline (colour, thickness), **3D** extrude (depth, colour, direction), soft shadow,
  - arc (bent like the game's logo), tilt, letter spacing,
  - an **emblem**: star, mushroom, coin, heart, crown or shell, left, right, on top or behind.

  The logo is saved as a high-resolution picture (about 2000 pixels wide, see-through), so
  the playable game needs none of the fonts and the logo stays sharp on big screens.
- **Upload**: your own picture. PNG (transparency works), SVG (turned into a sharp 2048 px
  picture), JPG or WebP. Click the box or drop the file on it.
- **Game's logo**: the original 3D logo zooms in (only with *The game's title* background).
- **None**.

**Animation**: *Wobble* (bounces in, then sways like the game's logo), *Zoom in*, *Wave*
(like a flag), *Float*, *Drop* (falls in and bounces), *Fade*, *Still*.

**Place and size**: drag the logo in the preview to move it, scroll over it to resize, or use
the sliders. *Centre it* puts it back; *Replay* plays the animation again.

## Title

**Background**

| | |
|---|---|
| *The game's title* | The engine's own title screen, live: **Mario's face** (the Goddard head players can pull) over the tiled backdrop. Untick *Mario's face* to remove it. The **backdrop** tiles can show your logo on your colours (automatic when you have a logo), just your colours, or the game's own "SUPER MARIO 64" tiles. |
| *A level* | A camera **flies around** one of your levels or an original level, live (water moves, enemies walk). Mario and the HUD are hidden. Speed, distance and height are sliders; **Circle around what the camera sees** uses the current level and camera view as the centre. |
| *Gradient* · *Colour* | Two colours and a direction, or one colour. |
| *Picture* | An image you upload (covers the screen). |

*Darken* dims a picture, a level or the game's title so the logo stands out.

**Press Start**: the text (empty for none), the game's own pixel font or a bold/serif font,
colour and outline, size, position, blinking.

**Music**: no music, any of the game's songs, or one of **your songs from the Sound studio**.
The ▶ button listens to it.

## Splash screens

Up to 6 short screens before the title, each shown for 0.5–10 seconds (players can click or
press a key to skip):

- **Made with Studio 64** (the star and the name),
- **Text**: a line and a small line (for example your name and "presents"),
- **Picture**: your studio's or your own logo, with an optional caption.

Each has a background and text colour; the arrows change the order.

In the playable game the splash screens play **while the game loads**, so they cost players no
time.

## File select

After Press Start: a heading (*SELECT FILE*, or your own text), the hack's name, an optional
small line, the file card with the stars collected, and **Continue** / **New game** (only
*Start* for a new player). Colours: the heading, the background (top and bottom) and the card.
Turn it off to go from Press Start straight into the game. Keys: `←` `→`, `Enter`; the mouse
and gamepads work too.

## Where it shows

- **Play from start** (Story panel, World tab, Claude): splash screens, title, file select,
  then the hack starts with a fresh save (*Continue* keeps the save). `Esc` skips the launch
  screen.
- **The playable game** (Share → Playable game): it replaces the player's title card. The
  Nintendo note stays at the bottom of the screen.
- **The home screen**: when the project has no cover picture of its own, its card shows a
  still of the title screen (logo on its background).

## How it works

- Data: `project.title` (normalized by `web/js/title/schema.js`):
  `{ on, splashes, logo: { kind, file, maker, anim, x, y, scale }, bg: { kind, head, tiles, ... , level, orbit }, press, music, files, cover }`.
  Pictures (uploads, the logo maker's renders, the cover still) are files in
  `server/projects/assets/<id>/title/`, named by their content, so the project file, version
  restores, duplicates and the playable game take them along.
- Server: `server/routes/title.js`: `GET/PUT /api/projects/:id/title` (a PUT is one undoable
  project-wide change, path `['title']`, sent to every tab as `{ type: 'title' }`),
  `POST /api/projects/:id/title/file?ext=png`, `GET /api/projects/:id/assets/title/<file>`.
- Browser: `web/js/title/`: `schema.js` (data, presets, fonts), `logo_maker.js` (the
  renderer: layers of shadow, extrude, outline, fill and shine per letter), `title_screen.js`
  (the runtime: draws every stage on a canvas over the game; `TitleStage` drives the engine),
  `title_ui.js` (the editor), `index.js` (studio glue: saving, the Play-from-start wrapper,
  palette commands, the card on Start & end, Claude's browser side), `player.js` (the
  standalone player). Styles: `web/css/title.css` (editor); the overlay's few styles are in
  `title_screen.js` so the player needs no extra file.
- Engine (`engine/src/studio/title.c`): `studio_title_enter(logo, head)` takes the game to its
  own title screen the way a game over does (`fade_into_special_warp(-2)`, or `-8` with the
  game's 3D logo first); while it is up the game's "PRESS START" text, its attract-mode demo
  and Start are off (`level_select_menu.c`), `studio_title_head(on)` hides Mario's face
  (`mario_misc.c`), the page does not patch the title's areas (`studio.c`). `studio_title_leave(level)`
  boots a level again through Studio 64's boot path. The backdrop tiles are replaced with
  texture overrides on `studio_title_tile(0..3)`. For a fly-over, `studio_title_scene(on)`
  hides Mario (`ACT_DISAPPEARED`, intangible) and the HUD, and the page moves the camera with
  `studio_set_camera`.

## Claude's tools (server/tools/title.js)

`get_title_screen`, `set_title_screen` (any field; logo maker settings and presets by name;
the user's browser renders the logo), `preview_title_screen`.

## Tests

`tests/suite/title_screen.test.mjs`: the editor from the Story panel (switch, logo text, a
style, animation, dragging the logo, background, Press Start, splash screens, file select, an
uploaded PNG, `Ctrl+Z`), Play from start through splash, title and file select into the game,
the game's title screen with and without Mario's face, a level fly-over, persistence across a
reload, the home card cover, the `.s64hack` round trip with the logo file, and the standalone
player showing the same launch screen. Pictures in `tests/out/title_screen/`.

## Limits

- The game's own file select (four files, copy, erase, sound mode) is replaced by the launch
  screen's single file card: Studio 64 hacks have one save per browser and project.
- The *Game's logo* option only shows the original 3D logo with *The game's title* background
  (in the editor's preview it is a stand-in).
- The logo maker's fonts come from Google Fonts in the studio; without internet the logo uses
  a system font (the saved picture keeps whatever font it was made with).
