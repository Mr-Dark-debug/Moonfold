# The road to 1.0, Moonfold's first stable release

Status: plan. Decision: D-71. Branch: `stable-1`, with one short branch per feature merged into it,
and `stable-1` merged to `main` as each feature is verified.

## What 1.0 contains beyond 0.1.0-beta.5

| #   | Feature                                      | Plan                                                           | Size                                               |
| --- | -------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| 1   | Project knowledge and the CI fixer           | [project-knowledge-ci-fixer.md](project-knowledge-ci-fixer.md) | Small: extends memories and the pull request watch |
| 2   | The living mark, council glyphs, skill icons | [mascot.md](mascot.md)                                         | Medium: one component, several surfaces            |
| 3   | Anywhere: the phone on any network           | [anywhere.md](anywhere.md)                                     | Medium: protocol, relay, server, Android           |
| 4   | Orbit: the always-on crew                    | [orbit.md](orbit.md)                                           | Large: builds on 1 and 2                           |

Order: 1, 2, 3, 4. The CI fixer comes first because Orbit depends on it. The living mark comes
before Orbit because the crew rail uses its states. Anywhere is independent and sits between them
so the Android work is not left to the end.

Each feature follows the project's rules: plan first, small commits, tests at the lowest layer
that fails, real providers before "done", the REA gate for every new dependency and artifact,
`PROGRESS.md` updated at the end.

## The 1.0 gate

1.0 is cut only when all of this is true, with the output recorded in `PROGRESS.md`:

- All four features meet their own plan's verification, including one real-provider run each.
- The open items carried from beta 5 are closed:
  - a click-through of the published build on web, desktop and the phone;
  - `/brand` and question cards run against a live provider;
  - evals for all model-facing text added since beta 3;
  - Electron fuses reviewed and hardened where the server sidecar allows;
  - the hosted Connect account pages removed from the bundle;
  - the reverse image search of the mark that [BRAND.md](../BRAND.md) still lists as not done.
- Lint, typecheck, unit, contract and end-to-end tests green on CI; a release dry run for every
  target; checksums and SBOM published.
- Upgrade test from beta 5 on a copy of a real database.
- Performance budgets measured: cold start, a 5,000-item thread, idle CPU and memory.
- Accessibility pass on the new screens: keyboard, focus, contrast, reduced motion.
- A new Android build, signed with the existing key, tested against the 1.0 server on the local
  network and through a relay.
- User guides for every feature; README, NOTICE and third-party licences current.

## What only the owner can do

1. **Approve the living-mark plan** and its three open choices (name, motion, docs site).
2. **A relay for Anywhere.** A free Cloudflare account for the project and one deploy, or a
   decision to ship 1.0 with "bring your own relay" only.
3. **The two landscape pictures** in home backgrounds (D-65): confirm the right to ship them, or
   they come out before 1.0.
4. **Provider access for verification.** Codex is limited until 19 November and Claude Code is
   not signed in on this machine. Real-provider runs wait for one of them.
5. **Orbit's name and default autonomy level**, and which channels come first.

Everything else is decided in `docs/DECISIONS.md` as it comes up.

## Risks

- **Scope.** Orbit is the largest feature Moonfold has taken on. It is built level by level
  (Observe, Propose, Ship, Publish), and 1.0 can ship with the first two verified and the others
  behind a build flag, never shown as working when they are not.
- **Unattended agents.** Spend, loops and injected instructions are designed against in the Orbit
  plan; the one-week run is the proof.
- **The relay** makes the project an operator of a small service for the first time. It carries
  only encrypted bytes and anyone can run their own.
- **Usage limits** on the machine doing the work slow verification more than they slow coding.
