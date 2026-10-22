# Route plug-ins

Each `*.js` file here default-exports `(ctx) => ({ http, ws })`, loaded by `../index.js` at start:

- `http(req, res, url)`: called for every `/api/...` request (after the password check), before the
  built-in routes. Return `true` when you answered the request.
- `ws(msg, client, project)`: called for websocket messages the built-in switch does not know.
  Return `true` when handled.

`ctx` has `hub` (broadcast, send, rpc, patchChanged, undo, redo), `projects` (server/projects.js),
`clients` (projectId -> Set of connected clients), `agents`, `agentFor`, `json(res, code, obj)`,
`readBody(req, limit)`, `authorized(req)`, `clientCatalog` (JSON string), `ROOT`, `WEB`.

A plug-in that fails to load is logged and skipped; the server keeps running.

Per-project binary files belong in `projects.assetDir(id)` (`server/projects/assets/<id>/`):
exports (.s64hack, standalone), duplicates and deletes take that folder along (any path below
`server/projects/` with a segment named after the project id counts).
