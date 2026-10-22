# Sound studio

Compose music that plays through the game's own sound engine, and make or record sound
effects that replace the game's. Open it with **Sound** in the rail or the `M` key; `Esc` closes it.

![The sound studio](img/sound.png)

- [Music](#music)
- [Sound effects](#sound-effects)
- [Limits](#limits)
- [How it works](#how-it-works)

## Music

The **Music** tab lists your songs and all of the game's music.

**Listen and pick.** Every song of the game is there, grouped (courses, Bowser, power-ups,
events, ...), with a play button. The level's music is chosen in build mode's
[Terrain tab](levels-and-terrain.md#level-settings), which lists your songs too.

**Compose.** Click **New song** and start from a starter or from nothing:

| Starter | |
|---|---|
| Sunny Fields | Bouncy course music with drums |
| Snowy Night | Slow and calm, sustained chords |
| Lava Rush | Fast and tense, for danger |
| Deep Water | Floating arpeggios |
| Empty song | Start from nothing |

The editor:

- **Sound set**: the band. Each of the game's songs uses a set of instruments; pick the set of
  one of them (for example *Star collect / Bob-omb Battlefield*).
- **Tracks**: **+ Instrument** adds a track with one of the set's instruments, **+ Drums** a drum
  track. Each track has volume, pan, mute and a preview button.
- **Piano roll**: click to add a note, drag to move it, drag its end to make it longer, click it
  again or right-click to delete it. *Note length* sets the length of new notes.
- **Tempo** (40 to 240 bpm) and **Bars** set the song's length and speed.
- **Play** plays the song through the game's own sequence player, so it sounds exactly like it
  will in the game.
- **Use in this level** makes it the music of the level you are in.

## Sound effects

The **Sound effects** tab has your own sounds and the game's.

**Make a sound** (*Synth*): a small retro synthesizer. Start from a preset (coin, jump,
power-up, laser, explosion, hit, blip, bounce, magic, 1-up, hurt, wind), press **Random** for
a surprise or **Vary it** for a variation of the current sound, and adjust the sliders.

**Record or upload** (*Recording or file*): **Record** up to 5 seconds with your microphone, or
**Choose a file** (mp3, wav, ogg).

**Replace a game sound.** **Game sounds** lists the game's sound effects (about 400) to listen
to. Pick one and **Replace** it with one of yours, or use **Use instead of a game sound…** on
your sound. From then on your sound plays everywhere the game uses that one: every coin, every
jump. The list on the left shows which game sounds you replaced.

## Limits

- A song can have up to 12 tracks.
- A song must fit the game's sequence cache: about 8 KB of sequence data. The editor shows how much
  is used ("1.5 of 8 KB").

## How it works

- Songs are encoded to the game's own sequence format (`.m64`) in the browser (`web/js/music.js`)
  and installed into two sequence slots that Studio 64 does not otherwise use: one for level
  music, one for previews (`engine/src/studio/audio.c`).
- Instrument names come from `tools/analyze_instruments.py` (with `tools/seq_usage.py`), which
  names the instruments of every sound set from the samples and from how the game's songs use
  them (`web/data/instruments.json`). `tools/gen_sounds.py` lists the game's sound effects
  (`web/data/sounds.json`).
- The synthesizer is `web/js/sfx.js`; the studio is `web/js/sound_ui.js`.
- Songs and sounds are saved in the project, so the [playable game](projects.md#playable-game-standalone-export)
  and the project file include them.
