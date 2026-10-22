# AI providers: use any LLM

Studio 64's chat runs on Claude through your subscription by default, but any model can build
levels: the Anthropic API, OpenAI, OpenRouter, Google Gemini, Groq, Together, DeepSeek, Mistral,
xAI, Ollama, LM Studio, llama.cpp, vLLM, or any server that speaks the OpenAI Chat Completions API.
Every model gets the same studio tools (spawn, build, terrain, look, ... and all plug-in tools).

## Set one up (two clicks)

1. Open the model menu under the chat box and choose **AI settings…**
2. Pick a provider on the left, paste the API key, press **Connect**.

Connect checks the key, lists the provider's models and puts a good first model into the chat's
model menu. Add more from the list (search, filter to models with tools; capability badges show
tools, vision, context size and price), or type any model id by hand. **Test** next to a model
sends one tiny request with one tool to see that the model answers and calls tools. **Use in this
project** switches the current project to it; each project remembers its model. The footer sets
the default model for new projects.

| Provider | Key from | Env var (instead of the dialog) | Notes |
|---|---|---|---|
| Claude (subscription) | `claude` login on the server | `ANTHROPIC_API_KEY` | built in, the default, the best results |
| Anthropic API | console.anthropic.com | `ANTHROPIC_API_KEY` | Claude billed per use, prompt caching on |
| OpenAI | platform.openai.com/api-keys | `OPENAI_API_KEY` | |
| OpenRouter | openrouter.ai/keys | `OPENROUTER_API_KEY` | hundreds of models with one key; Connect shows your credit |
| Google Gemini | aistudio.google.com/apikey | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | through Google's OpenAI-compatible endpoint; free tier |
| Groq | console.groq.com/keys | `GROQ_API_KEY` | very fast |
| Together AI | api.together.ai | `TOGETHER_API_KEY` | |
| DeepSeek | platform.deepseek.com | `DEEPSEEK_API_KEY` | text only (no screenshots) |
| Mistral | console.mistral.ai | `MISTRAL_API_KEY` | |
| xAI Grok | console.x.ai | `XAI_API_KEY` | |
| Ollama | no key | `OLLAMA_HOST` | native API, so the context size is set (default 32k) |
| LM Studio | no key | | Developer tab, Start server (port 1234) |
| llama.cpp | no key | | `llama-server -m model.gguf --jinja -c 32768` (`--jinja` is needed for tool calls) |
| vLLM | optional | `VLLM_API_KEY` | `vllm serve <model> --enable-auto-tool-choice --tool-call-parser <parser>` |
| Custom endpoint | optional | | **Add endpoint**: any OpenAI-compatible base URL (ending in `/v1` usually) |

Local models: pick one trained for tool calling (Qwen 3, Llama 3.1+, Mistral Small, GPT-OSS,
...); 7B+ works, bigger is better. Local providers start in **Lite mode** (Advanced): only the 20 core
tools and a shorter tool list, which small models handle much better. Turn it off for big models.

## Using Studio 64 without AI

AI is optional. Studio 64 is a complete editor without it: playing, building with blocks and
objects, terrain, levels and stars, story, sound, assets, testing and sharing all work by hand.

- **No AI connected** (no Claude Code login on the server, no `ANTHROPIC_API_KEY`, no provider set
  up): the app starts without AI by itself. Nothing tries to start an AI session.
- **Turn it off**: *... menu → AI assistant…* (or *AI settings…* in the model menu) has a switch on
  top. Off hides it in this browser (saved per browser); *Off for everyone on this server* turns it
  off on the server (saved in the settings file). `STUDIO_AI=off` turns it off for good (the switch
  is then locked).
- Without AI, the chat column is gone and the game and editor take the whole width (the edit
  history and the stars stay, as a panel: `Ctrl+J`). Every AI entry point disappears: the chat, the
  model menu, "Ask Claude about this…" in the inspector, "Let Claude build this level" for pictures
  (the height-map option stays), image paste into the chat, AI tips in the tour, the palette, the
  placeholders and the loading screen.
- `/api/config` reports `ai: { available, enabled, claude, providers, reason }`; the server refuses
  chat messages when `available` is false.
- Claude detection: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`,
  Bedrock/Vertex env, or `~/.claude/.credentials.json` (`CLAUDE_CONFIG_DIR`; on macOS the account
  in `~/.claude.json`). `STUDIO_CLAUDE=off` pretends there is no login (tests), `STUDIO_CLAUDE=on`
  trusts that there is one. Without a Claude login the Claude models leave the model menu and a
  project using one switches to another set-up model.

For developers: elements with the attribute `data-ai` are hidden in no-AI mode, `data-no-ai` ones
are shown only then (`body.no-ai`, web/js/ai_mode.js: `aiOn()`, event `studio-ai-mode`).

## Where keys live

Keys are stored on the server in `~/.config/studio64/ai.json` (mode 0600; `STUDIO_AI_CONFIG`
moves it). Browsers never get a key back: the dialog only sees a masked hint like `sk-or-v…c77c`.
Changing a provider's base URL drops its stored key unless a new key comes with it, so a key can't
be redirected to another server. All `/api/ai/*` routes sit behind `STUDIO_PASSWORD`, and before
the password is known `/api/config` lists only the Claude models. `STUDIO_AI_LOCKED=1` makes the
settings read-only from browsers (edit the file instead), useful on a shared server. Keys are
never logged.

The file, if you prefer to write it by hand:

```json
{
  "defaultModel": "@openrouter/qwen/qwen3.7-flash",
  "providers": {
    "openrouter": { "apiKey": "sk-or-...", "models": [{ "id": "qwen/qwen3.7-flash" }] },
    "ollama": { "models": [{ "id": "qwen3:8b" }], "contextTokens": 32768, "lite": true },
    "custom": { "name": "My vLLM", "baseUrl": "http://gpu-box:8000/v1", "models": [{ "id": "Qwen/Qwen3-32B" }] }
  }
}
```

Model ids in projects are `@<provider>/<model>` (e.g. `@ollama/qwen3:8b`); plain ids like
`claude-opus-5-5` are the subscription models.

## How it works

- `server/ai/config.js`: presets, the settings file, the model menu, masked public settings.
- `server/ai/providers.js`: one streaming adapter per API: Anthropic Messages (`/v1/messages`),
  OpenAI Chat Completions (`/chat/completions`, also Gemini, OpenRouter, Groq, local servers) and
  Ollama (`/api/chat`, NDJSON). Model lists, the connection check, the one-tool probe, and
  friendly errors (bad key, no credit, unknown model, rate limit, server down, context too long).
- `server/ai/loop.js`: the agent loop for every non-SDK model. It sends the conversation and the
  tools, streams text into the chat, runs the tool calls (lookups in parallel, edits one at a time in
  order, with the same tool cards as Claude), feeds results back and repeats, up to the step limit
  (40, Advanced). Stop cancels the request and the remaining calls.
- `server/ai/schema.js`: tool zod shapes to JSON Schema (zod 4 `toJSONSchema`, cleaned per
  provider: Gemini gets no `const`, no empty objects), and argument validation with repair for
  small models (numbers as strings, JSON text for objects, nulls, enum case).
- Images: `look` screenshots and pictures you attach go to the model as images (Anthropic: inside
  the tool result; OpenAI-style: a user message after the tool results; Ollama: `images`).
- Graceful degrade: a model that rejects tools keeps chatting without them (with a note); one that
  rejects images gets the text only; both are remembered for the next turn. Tool calls written as
  text (`<tool_call>{...}</tool_call>`) are picked up too. Rate limits, overload and network
  hiccups are retried twice when nothing was streamed yet.
- Conversation: each project keeps its own history (`aiHistory` in the project file, without
  images). When it gets near the model's context, old tool results are shortened and the oldest
  turns are folded into a written summary; the stored history is capped the same way. **New chat**
  clears it.
- Switching models mid-chat: when the conversation moves between Claude (SDK session) and another
  provider, the new side gets a short transcript of what happened on the other side
  (`<earlier_chat>`), so "make it bigger" still knows what "it" is.
- Reasoning models: OpenRouter `reasoning_details` and Gemini thought signatures
  (`extra_content`) are sent back with the tool calls, DeepSeek `reasoning_content` within a turn.
- Plug-in tools (`server/tools/*.js`) work unchanged on every provider; see `server/tools/README.md`.

## HTTP API (password-protected)

| Route | |
|---|---|
| `GET /api/ai/settings` | providers (masked), the model menu, the default |
| `GET /api/ai/menu` | the chat's model menu |
| `POST /api/ai/provider` `{id, apiKey?, baseUrl?, models?, lite?, contextTokens?, maxTurns?, name?, remove?}` | save |
| `POST /api/ai/custom` `{name, baseUrl, apiKey?}` | add a custom endpoint |
| `POST /api/ai/test` `{id, apiKey?, baseUrl?}` | check unsaved values: `{ok, ms, models, account}` or `{ok:false, error}` |
| `POST /api/ai/models` `{id}` | list models |
| `POST /api/ai/probe` `{id, model}` | one tiny request with one tool: `{ok, tools, ms}` |
| `POST /api/ai/default` `{model}` | default model for new projects |
| `POST /api/ai/enabled` `{enabled}` | the AI assistant on/off for everyone on the server |

## Tests

```sh
node tests/scripts/ai_loop.mjs                       # loop + all three API dialects against the mock, no browser
node tests/lib/mock_llm.mjs 8099 &                   # scripted fake LLM (OpenAI, Anthropic and Ollama dialects)
STUDIO_URL=http://127.0.0.1:8072 node tests/scripts/ai_providers.mjs   # settings dialog + chat in the browser
REAL=openrouter:qwen/qwen3.7-flash STUDIO_URL=... node tests/scripts/ai_providers.mjs   # + one real turn
```

Tested for real (2026-10-20, about 3 cents on OpenRouter): Qwen 3.7 Flash, Gemini Flash (3 tool
steps with a screenshot), GPT-OSS 20B (no vision: screenshot left out, answered from the state),
Granite 4.0 Micro (no tools: chat only with a note), and switching to Claude Haiku in the same chat
(it knew what the other model had built).
