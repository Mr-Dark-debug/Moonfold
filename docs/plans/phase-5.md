# Phase 5 plan: more providers

Goal: every provider Moonfold lists works on a real install, reports its limits for handoff, and
has a docs page. A provider that cannot be verified on a real install is not listed as supported.

## What exists

- Adapters: Codex, Claude, Cursor, OpenCode, Grok, Antigravity, Pi, Muse, and the ACP Registry
  provider, which runs any agent from the public ACP registry or a local ACP command (`source:
  local`, `commandPath`, `commandArgs`).
- Limit signals mapped today: Codex, Claude, Grok, Mistral Vibe (docs/HANDOFF-SIGNALS.md).

## Findings from recon (2026-10-20, this machine)

- Gemini CLI 0.43.0 speaks ACP (`gemini --acp`). With a Google account login, Google refuses new
  sessions: "This client is no longer supported for Gemini Code Assist for individuals ... migrate
  to the Antigravity suite" (JSON-RPC `-32000`, `IneligibleTierError`, reason
  `UNSUPPORTED_CLIENT`). It still offers `gemini-api-key` and `vertex-ai` auth methods.
- Installed here: Codex CLI 0.163.0, Claude Code 2.1.303 (both at their usage limits until
  November), Gemini CLI 0.43.0, Antigravity (`agy`). Not installed: Cursor agent, OpenCode, Grok.

## Work items

1. **Gemini CLI** through the ACP Registry provider (no new adapter):
   - A preset that adds a Gemini instance as a local ACP command (`gemini --acp`) or the registry
     agent `gemini`, using the user's own login.
   - Map Gemini's refusals: `IneligibleTierError` / `UNSUPPORTED_CLIENT` becomes an authentication
     problem with a message that names the supported routes (API key, Vertex AI, or Antigravity);
     quota exhaustion (HTTP 429 `RESOURCE_EXHAUSTED`) becomes `usage_limit` for handoff.
   - Docs page; listed as "works with an API key or Vertex AI", not as verified, until a run on a
     real account succeeds.
2. **Antigravity**: verify the existing adapter end to end with `agy` on this machine (install
   detection, login status, model list, a turn, limit mapping), and as a handoff target.
3. **Cursor, OpenCode, Grok**: not installed here, so they cannot be verified on this machine;
   keep them, mark them unverified in the provider matrix, and document their limit signals from
   their sources (REA on the open-source CLIs).
4. **OpenAI-compatible endpoint**: evaluate. It would need Moonfold to run its own agent loop and
   hold an API key, which no adapter does today; decide and record in DECISIONS.
5. **Provider matrix** in README generated from a record of the checks that actually ran.
6. **REA gate** (docs/REA.md) on gemini-cli and any adapter dependency touched.

## Gate

Provider matrix in README generated from tests that ran on this machine; every listed provider
either verified here or marked unverified with the reason.
