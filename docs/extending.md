# Extending Studio 64

Studio 64 has a few small plug-in points, so a new feature can live in its own files instead of
being wired through the whole app. Read [Architecture](architecture.md) first.

- [AI tool plug-ins](#ai-tool-plug-ins)
- [The browser side: registerRpc](#the-browser-side-registerrpc)
- [Route plug-ins](#route-plug-ins)
- [Commands in the command palette](#commands-in-the-command-palette)
- [Panels and AI-free wording](#panels-and-ai-free-wording)
- [Storing data](#storing-data)
- [Engine functions](#engine-functions)

Every feature must work without AI. Build the UI first; an AI tool is an extra way to reach the
same code.

## AI tool plug-ins

Every `server/tools/*.js` file is loaded at start (alphabetically) and default-exports a
function that returns tools. They are added to the built-in tools of `server/agent.js` and work
on every AI provider (Claude through the Agent SDK, and Studio 64's own loop for the others).

```js
// server/tools/coins.js
export default function coinTools({ tool, z, card, rpc, text, opts }) {
  return [
    tool('count_coins', 'Count the coins near Mario.', {
      radius: z.number().optional().describe('in game units, default 2000'),
    }, card('count_coins', () => 'Counting coins', async (a) => {
      const r = await rpc('count_coins', { radius: a.radius ?? 2000 });   // runs in the user's browser
      return { summary: `${r.count} coins nearby`, result: text(r) };      // summary: the tool card in the chat
    }), opts),
  ];
}
```

What the context gives you:

| | |
|---|---|
| `tool(name, description, zodShape, handler, opts)` | Defines a tool (Agent SDK `tool`). Pass `opts` as the last argument. |
| `z` | zod, for the input schema. Keep schemas plain: objects, enums, numbers, strings, arrays. |
| `card(name, labelFn, fn)` | Wraps a handler so the chat shows a tool card (running, done, failed). `fn` returns `{ summary, result }`; a thrown error becomes a failed card and an error result. |
| `rpc(method, params)` | Calls a browser method (below) in the tab of the user who sent the message. |
| `commit(kind, res, summary, extra)` | Stores records as one undoable change, like the editor does (`extra.objects`, `extra.removals`, `extra.remote` for the other tabs). |
| `text(obj)`, `fail(message)` | Tool results. Images: `{ type: 'image', data: <base64>, mimeType }` in `content`. |
| `where` | The shared zod schema for "where" (in front of Mario, at x/z, around, ...). |
| `project`, `projects`, `agent` | The project, the storage module, the agent (`agent.hub.broadcast(...)`) |
| `findCustom`, `levelName`, `levelByKey`, `getEntry`, `friendlyName`, `search` | Lookups for levels and the catalog |

Rules of thumb:

- Tool names starting with `get_`, `list_`, `search_`, `probe_`, `find_`, `describe_`, `inspect_`
  (or with `annotations: { readOnlyHint: true }`) may run in parallel; all others run one at a time.
- A plug-in that throws is logged and skipped; the chat keeps working. A tool name defined twice:
  the later one wins, with a warning.
- Real examples: `server/tools/projects.js` (small), `objects.js`, `world.js`, `story.js`, `assets.js`.

The reference is `server/tools/README.md`.

## The browser side: registerRpc

`rpc(name, params)` on the server runs a method in the browser, against the live game:

```js
// web/js/coins.js (imported from app.js, or from your feature's module)
import { registerRpc } from './studio.js';

registerRpc('count_coins', function ({ radius = 2000 } = {}) {
  // `this` is the Studio (web/js/studio.js): this.engine, this.catalog, this.world, ...
  const r = this.objects({ query: 'coin', radius, limit: 500 });
  return { count: r.total };
});
```

The return value goes back to the tool as the rpc result; a thrown error becomes the tool's error.
Built-in methods (`state`, `place`, `remove`, `build`, ...) are in `Studio.handle()`;
registered ones are looked up after them.

## Route plug-ins

Every `server/routes/*.js` file default-exports `(ctx) => ({ http, ws })`:

```js
// server/routes/hello.js
export default function hello({ json, projects }) {
  return {
    http(req, res, url) {
      if (url.pathname !== '/api/hello') return false;
      json(res, 200, { projects: projects.listProjects().length });
      return true;   // handled
    },
    ws(msg, client, project) {
      if (msg.type !== 'hello') return false;
      return true;
    },
  };
}
```

- `http` is called for every `/api/...` request after the password check, before the built-in
  routes. Return `true` when you answered.
- `ws` gets websocket messages the built-in switch does not know.
- `ctx` has `hub` (`broadcast`, `send`, `rpc`, `patchChanged`, `undo`, `redo`), `projects`,
  `clients`, `agents`, `agentFor`, `json`, `readBody`, `authorized`, `clientCatalog`, `ROOT`, `WEB`.

The reference is `server/routes/README.md`; real examples are `server/routes/projects_hub.js`,
`assets.js` and `world.js`.

## Commands in the command palette

```js
window.studioShell.register({
  id: 'coins.count', label: 'Count coins', group: 'Tools', icon: 'sparkles', keys: '',
  run: () => { /* ... */ },
});
```

If your module may load before the shell, wait for the `studio-shell-ready` window event.

## Panels and AI-free wording

- New panels follow the design system and patterns in [UI](ui.md#design-system); adding a
  workspace or a build tool is described in [UI: adding a panel](ui.md#adding-a-panel).
- Use `askConfirm`, `askText`, `askChoice`, `notify` from `web/js/dialogs.js`, never
  `alert()`/`confirm()`/`prompt()`.
- **Without AI, nothing may mention AI.** Mark AI-only elements with `data-ai` (hidden when AI is
  off) and the wording that replaces them with `data-no-ai`. In code, check `aiOn()` from
  `web/js/ai_mode.js`, and listen for the `studio-ai-mode` window event if it can change while
  your panel is open.

## Storing data

- Small data: a key in the project JSON. Send it with your own websocket message (route plug-in)
  or, for per-area data, the `edit` op `{ type: 'area', key, field, value, summary }` with one of
  the allowed fields.
- Files: `projects.assetDir(id)` (`server/projects/assets/<id>/`).
- Either way, the project file, the playable game, duplicate, delete and versions include it
  without extra code ([Projects](projects.md#project-file-s64hack)).
- Re-apply your data when an area loads with `engine.levelHooks` (before the records spawn) or
  `engine.afterAreaHooks` (after), and take over special records with `engine.spawnFilters`.

## Engine functions

A new C feature goes in `engine/src/studio/` (the Makefile builds every `.c` file there).
Export functions to the page with `EMSCRIPTEN_KEEPALIVE`, call them from JavaScript as
`Module._studio_your_function(...)` (or through `ccall` for strings), and call the page from C
with `EM_ASM` on a `Module.studio...` function. Keep calls between frames. Rebuild with
`npm run build:engine` ([Building the engine](building-the-engine.md)).
