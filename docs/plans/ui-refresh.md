# UI refresh plan: bring in upstream's design overhaul, then score our own screens

Date: 2026-11-06. Branch: `ui-refresh`. Brief: the owner's request of 2026-11-06, after Theo's
video "Agents Sucked At UI (Until Today)" (3 November 2026).

## What upstream did

The video shows the method; the code is upstream pull request
[pingdotgg/t3code#24865](https://github.com/pingdotgg/t3code/pull/24865), merged 25 October 2026
(59 files, +583 / -269). Our base is upstream `17e1087d3` (imported 15 October, D-2), so none of it
is in Moonfold. Upstream is MIT and Moonfold is its fork, so porting the code is allowed. The
upstream copyright is already kept in LICENSE and NOTICE, and each commit names the PR it ports.

**Method ("hill climb").** One agent changes the UI and takes fresh screenshots of real data.
Reviewers from three providers then score them out of 10 against screenshots of competing apps,
and each lists fixes. The agent applies the fixes and the loop repeats until the scores stop
rising. A fourth reviewer's scores were logged but not counted. Upstream went from about 7/10 to
9.5 in 18 rounds. Their own caveats: the scores are subjective, and telling reviewers the target
inflates them.

**What changed, in four groups.**

1. **Foundations, on for everyone.**
   - Inter Variable on Windows and Linux, so medium and semibold weights render. macOS keeps the
     system font.
   - A tighter radius scale (base `0.5rem`) and icon strokes of 1.75 instead of 2.
   - Stronger contrast tokens: zinc-900 text in light mode, dark-mode borders at 8% and inputs at
     11%, neutral-400 muted text, and sidebar icons at 85%.
   - Inline code without a border at `0.85em`, `strong` at 600, and code blocks at the 8px radius.
   - Darker diff colors in light mode (emerald-700 / red-700), and a user bubble one step darker.
   - A flat composer shadow.
2. **Sidebar** (behind a toggle upstream).
   - The title leads each row. Read titles sit at 75% and brighten on hover; unread and open
     titles are full strength.
   - Metadata sits one step below the title.
   - Project and agent icons stay gray until hover, with a setting to keep them in color.
   - PR numbers are neutral, and only the state icon keeps its color.
   - Branch names cut at a whole letter. Shelf headers read "Snoozed 1 ›".
3. **Composer.**
   - It rests two lines tall and uses one neutral control style with no dividers.
   - A gauge icon for effort, and a flat "compact next / keep full" control instead of the amber
     pill.
   - One placeholder everywhere.
4. **Details panel and Settings.**
   - Panel rows have one leading icon, a muted editor icon, and dividers only on hover.
   - PR titles wrap to two lines, with "33/34 checks" below.
   - Empty drafts hide Push and zero Changes.
   - Settings get 16px semibold section titles, boxed scope pickers, balanced wrapping, and an
     inheritance marker only when a value is overridden.

Smaller follow-ups landed between 2 and 6 November. The ones that touch components we also have:

- [#30464](https://github.com/pingdotgg/t3code/pull/30464): the composer floats over the chat.
- [#30568](https://github.com/pingdotgg/t3code/pull/30568): composer text stays clear of the send
  buttons.
- [#30470](https://github.com/pingdotgg/t3code/pull/30470): one green for PR badges.
- [#30559](https://github.com/pingdotgg/t3code/pull/30559): empty detail cards are hidden.
- [#31105](https://github.com/pingdotgg/t3code/pull/31105): no "Merged" status in sidebar rows.

Everything built on upstream's newer panes and workspaces is out of scope. Moonfold doesn't have
those features.

## Where Moonfold stands

- Ten of the 59 files don't exist here, because upstream added them after our base:
  `ComposerFooterControls`, `ComposerControlsBar`, `SidebarThreadRow`, `SidebarListMarkers`,
  `BetaSettingsPanel`, `AppearanceSettingsPanel`, `TimelineMinimap`, `MarkdownDetails`, the
  middle-truncate test, and one mobile screen. Their changes are rebuilt on our equivalent
  components by intent, not copied line by line.
- `index.css` already differs: Moonfold's neutrals are hex values, because Chromium up to 133
  draws `oklch(… none)` as blue (beta 4 fix). Port the token values, and keep the hex neutrals
  where they apply.
- Upstream never touched Moonfold's own screens: handoff, Mobile App, Prompt Profiles, Agent
  limits, the welcome wizard and About. The scoring loop below covers them.

## Decision (D-62)

Port the foundations for everyone. The sidebar, composer and panel changes go behind
**Settings → Appearance → New design**, and it is **on by default**. Moonfold is in beta, upstream's
reviewers rated the new look higher, and the toggle is the way back. "Restore defaults" resets it.
Mechanism: as upstream does, the toggle sets `data-redesign` on `<html>`, and a `redesign:`
Tailwind variant handles most of the styling. That keeps every component single-sourced, with no
second set of components.

## Work, in order

Each step is one commit, verified before the next.

1. **Foundations.**
   - Add `@fontsource-variable/inter` (OFL-1.1 font, MIT package) and regenerate
     THIRD_PARTY_LICENSES.
   - Font stack in `index.css` and `appearanceFonts.ts`.
   - Radius, stroke rule, contrast tokens, chat markdown, diff colors and composer shadow.
   - Check both themes against the hex neutrals.
2. **Toggle.**
   - `redesignEnabled` and `sidebarProjectIconColors` in the `ServerSettings` contract.
   - The `redesign` custom variant, and the `<html>` attribute set in `__root.tsx`.
   - A row in Appearance, a settings search entry, and a Restore defaults case.
3. **Sidebar.** The row hierarchy, gray icons, neutral PR numbers, whole-letter branch truncation
   (`middle-truncate` with its test), shelf headers, and instant hover swap. Update
   `docs/user/thread-sidebar.md` where its wording changes.
4. **Composer.** Two-line rest, one control style, the gauge effort icon, the compact control, one
   placeholder, the checkout strip, and the floating composer follow-up.
5. **Details panel.** Leading icons, the muted editor icon, hover dividers, two-line PR titles with
   the checks count, and the empty-draft rules.
6. **Settings.** Section titles, scope pickers, chevrons, `text-wrap: pretty`, and the inheritance
   marker. Wording that changes is written in Moonfold's own voice.
7. **Moonfold's own screens.** Put handoff, Mobile App, Prompt Profiles, Agent limits, welcome
   wizard and About through the scoring loop below, until they score as high as the ported
   screens.

## Scoring loop for our own screens

- **Screenshots:** real data from `vp run migrate-dev-db`, in a worktree dev server at 1280×832.
  Light and dark, for thread, new thread, settings, handoff and mobile pairing.
- **Rubric:** `docs/design/rubric.md`, which we write.
  - Seven categories: hierarchy, typography, spacing, color and contrast, consistency, affordance,
    and density.
  - Each is scored out of 10, with a list of concrete fixes.
  - Reviewers never see the score we're aiming for.
- **Comparison set:** our `main` before the change, and upstream T3 Code built from its own MIT
  source. Screenshots of other apps are for internal comparison only. They are never committed or
  shipped.
- **Reviewers:** one fresh reviewer per provider that can run. On this machine today only Claude
  Code is usable: Codex is at its limit until 19 November, and Gemini refuses sign-in. So the first
  rounds use separate fresh Claude reviewers, which is weaker than a multi-provider panel. Re-run
  with Codex after 19 November before claiming a score.
- **Stop:** when two rounds in a row gain less than 0.2, or after 10 rounds.
- **Budget:** each round is a normal thread, under the D-60 token limit.

## Hit every surface

- **Web and desktop:** same CSS.
- **Mobile app:** loads the web client, so it gets the new look automatically. Check the phone
  width.
- **Contracts:** two settings fields.
- **Settings search, docs:** the sidebar page.
- **Reverse state:** the toggle.
- **Accessibility:** AA contrast checked by script on the new tokens, focus rings unchanged, and
  reduced motion untouched.
- **Performance:** no new animations. Inter is loaded once, as a variable font.

## Done means

- Lint, format, typecheck for web and contracts, and the touched tests all pass.
- `check-brand`, `knip:check` and `vp check` pass before the merge.
- Before/after screenshots and the scoring rounds are recorded in `docs/QA-UI-REFRESH.md`.
- An REA gate on the new dependency.
