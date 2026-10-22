# FAQ

**Do I need to know how to program?**
No. Everything in the studio works with the mouse and keyboard. You only need to program if you want
to change Studio 64 itself.

**Do I need an AI, or an account anywhere?**
No. Studio 64 runs on your own computer and is complete without AI. The assistant is an optional
extra, and with nothing connected you won't see it at all. More in
[AI providers](ai-providers.md#using-studio-64-without-ai).

**Where do I get the ROM?**
Studio 64 doesn't provide it. Make a backup of a cartridge you own. It has to be the US version;
`.z64`, `.n64` and `.v64` files all work, zipped too, and the setup converts them.

**Can I edit the original levels, or only make new ones?**
Both. Add, move or delete objects in any original level, reshape its ground with the terrain
brushes, add stars, or build new levels from scratch.

**Does it make a ROM I can play on a console or an emulator?**
Not directly. Studio 64 exports a playable web game of your hack. It can also export your changes
to the original levels as level script C for the [SM64 decomp](https://github.com/n64decomp/sm64),
and you can build a ROM from that yourself. See
[Projects](projects.md#decomp-export-real-rom-builds).

**Can I share my hack?**
Send the project file (`.s64hack`) to people who have Studio 64 and the game. The playable game
export contains Nintendo's code and assets from your ROM: play it yourself or share it privately with
people who own the game, but don't publish it or sell it.

**Can several people work on one hack?**
Yes. Everyone who opens the project link edits the same project live. To let other devices in,
start the server with `HOST=0.0.0.0` and a `STUDIO_PASSWORD`. See [Settings](settings.md).

**Which browsers and systems work?**
Any desktop browser with WebGL; it's tested in Chrome. Studio 64 itself runs on Windows 10/11, macOS
13+ and Linux and downloads what it needs into its own folder. The setup is tested automatically on
five Linux distributions. Windows and macOS have a ready GitHub workflow but haven't had a run on a
real machine yet (see [What was tested](getting-started.md#what-was-tested)). On small screens the
studio switches to a play + chat layout.

**Where are my projects stored?**
In the Studio 64 folder, under `server/projects/`: one JSON file per project, plus folders for
assets and versions. Deleted projects go to `server/projects/trash/`. When you update, the new
version's setup page offers to bring them over from the old folder.

**Something doesn't work.**
Check [Troubleshooting](troubleshooting.md). If that doesn't help,
[open an issue](../CONTRIBUTING.md#reporting-a-bug).
