# Tool plug-ins

Each `*.js` file here default-exports `(ctx) => [tool(...), ...]`: tools the AI can call, added to
the built-in ones in `../agent.js` (makeTools). `ctx` has `tool, z, card, rpc, commit, text, fail,
where, opts, project, projects, agent, findCustom, levelName, levelByKey, getEntry, friendlyName,
search`. Browser-side methods for `rpc(name, params)` are registered with
`registerRpc(name, fn)` from `web/js/studio.js` (fn runs with `this` = the Studio).

The same tools run on every AI provider (Claude through the Agent SDK, and the studio's own loop in
`../ai/loop.js` for the Anthropic API, OpenAI-compatible servers, Gemini and Ollama). For the loop,
the zod shape becomes JSON Schema, arguments are validated (and gently repaired: "2" -> 2, JSON
text -> object, null -> omitted) before your handler runs, and an error result goes back to the
model. Keep schemas plain (objects, enums, numbers, strings, arrays; avoid recursion). Tools whose
names start with `get_`, `list_`, `search_`, `probe_`, `find_`, `describe_`, `inspect_` (or that pass
`annotations: { readOnlyHint: true }`) may run in parallel; everything else runs one at a time in
order. Return images as `{ type: 'image', data: <base64>, mimeType }` content, like `look`.

## Without AI

Studio 64 must be complete without any AI (no AI connected, `STUDIO_AI=off`, or the user switched
it off). `<body>` then has the class `no-ai` (web/js/ai_mode.js). In the web app, mark every
AI-only element with the attribute `data-ai` (it is hidden then), and wording that replaces an AI hint
with `data-no-ai` (shown only then). In code use `aiOn()` from `web/js/ai_mode.js` (or
`document.body.classList.contains('no-ai')`), and listen to the window event `studio-ai-mode` if
something must change when it is switched at runtime. Every feature a tool offers should also be
reachable by hand; the tools are the AI's way into the same features, never the only way.
