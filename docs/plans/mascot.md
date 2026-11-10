# The living mark: Moonfold's mascot system

Status: plan, waiting for the owner's approval before any code. Decision: D-67.

## What we are building

One brand character, and it is the mark itself: the crescent, the orbit ring and the star from
[docs/BRAND.md](../BRAND.md), given life through small state-driven motion. No face, no limbs, no
sidekick. Three pieces share one geometry source:

1. **The living mark**: five states that say what Moonfold is doing.
2. **Council glyphs**: a small identity glyph for each reviewer in a multi-provider review round.
3. **Skill icons**: one glyph per skill source kind, in the skills manager and the slash menu.

There is no mascot per feature and no mascot per skill (D-67). Skills are written by users and have
no upper bound, so they get a kind icon, not a character.

## The five states

Each state differs in shape, not only in motion or colour, so it still reads when motion is off.

| State              | Motion                                                                  | Still pose (reduced motion)                                                   |
| ------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Idle               | At rest. The star twinkles once, slowly, a few times, then stops        | The mark as it is today                                                       |
| Working            | The star travels the orbit ring, fading as it passes behind the moon    | Star low on the front of the ring, with a short arc of three dots trailing it |
| Waiting for input  | The crescent breathes (scale 1 to 1.04). Star parked at its upper-right | Star parked, and the ring opens with a small gap below the star               |
| Done               | One four-point sparkle from the star, then it settles                   | Star with four short rays                                                     |
| Attention or error | The ring swings from -21.6 degrees to level and stays there; star dims  | Level ring and a hollow star                                                  |

"Working" is the brand line made literal: a moon that keeps moving, as a task keeps moving between
agents. It is the only state that loops, and it only runs while an agent is actually working.

### How the star travels with transforms only

The brief allows CSS transforms and opacity, nothing else. A point moves along a tilted ellipse
with nested groups whose transforms are either fixed or a plain rotation:

`rotate(tilt) > scale(1, k) > rotate(θ) > translate(rx, 0) > rotate(-θ) > scale(1, 1/k) > rotate(-tilt) > star`

The two animated rotations cancel, so the star never spins or stretches; what is left is a pure
translation along the ellipse (`k` is ring height over ring width). One keyframe pair drives both
rotations, and an opacity keyframe hides the star for the part of the lap that is behind the moon.
No JavaScript loop, no motion-path, no new dependency.

### Performance rules

AGENTS.md forbids continuously repainting animations. So:

- The star is its own small layer above the mark, so its motion is a compositor transform and the
  rest of the mark is never repainted. To be measured in Chromium, not assumed (see QA).
- Only "Working" loops. Idle twinkles a fixed number of times and rests. Done and Attention play
  once.
- At most one animated mark is on screen at a time (the composer's). Lists never animate.
- The loop pauses when the page is hidden.

## Geometry: one source

`scripts/lib/brand-mark.ts` stays the single model. It gains three exports, all in moon radii like
the rest of the file:

- `livingMarkParts()`: the mark split into layers (back ring, crescent, front ring, star), the
  ring's ellipse numbers for the orbit, and the extra shapes for the still poses.
- `councilGlyph(seat)`: seats 1 to 6.
- `skillGlyph(kind)`: `app`, `repo`, `project`, `personal`, `system`, `other`.

`scripts/render-brand-icons.ts` writes them to one generated module that the web client imports,
and to static SVG files for the docs site. Its existing `--check` mode, which CI already runs,
fails when the generated file is stale. `MoonfoldMark.tsx` keeps working as it does today and is
rebuilt on the same generated data, so its hand-copied numbers go away.

### Small sizes

Following `smallMark`: at 20 px and below the ring is heavier and fine detail is dropped. At 16 px
the star is drawn larger than true scale so its position on the ring still reads, and the trailing
dots become one dot.

## Council glyphs

A review round has reviewers from several providers. Each **seat** in the round gets a glyph, so
"who scored what" can be followed down a column of scores. The glyph belongs to the seat, not to
the provider, and the provider's name is always there as text beside it or in its tooltip. No
provider logos.

Six seats, told apart by two shape features so they hold at 16 px:

| Seat | Moon phase         | Star position on the ring |
| ---- | ------------------ | ------------------------- |
| 1    | Thin crescent      | Upper right               |
| 2    | Half moon          | Right                     |
| 3    | Gibbous            | Lower right               |
| 4    | Full disc          | Lower left                |
| 5    | Half, mirrored     | Left                      |
| 6    | Crescent, mirrored | Upper left                |

The app has no review-round screen today: rounds live in `reviews/` files written by Cassandre and
the UI scoring loop. This plan adds the smallest one, a **Review round card** that renders a round
file (seat, provider, score, fixes), used in the brand kit preview and in the thread when a round
finishes. The same glyphs are written into the brand book's reviews table.

## Skill icons

One 16 to 20 px glyph per source kind (`packages/client-runtime/src/providerSkills.ts`), different
in shape and tinted by a palette role, never by colour alone:

| Kind     | Glyph                           |
| -------- | ------------------------------- |
| app      | Ringed moon (the small mark)    |
| repo     | Crescent                        |
| project  | Orbit ring                      |
| personal | Star                            |
| system   | Full disc with the ring cut out |
| other    | Dot on a short arc              |

Shown in the skills manager and the composer's slash menu.

## Where it appears

| Surface                    | What                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| Composer and timeline      | Working, Waiting, Done and Attention, replacing today's working indicator |
| Review round card          | Council glyphs                                                            |
| Skills manager, slash menu | Skill icons                                                               |
| Welcome wizard             | Idle mark, Done when setup finishes                                       |
| Empty states               | Idle mark                                                                 |
| About                      | Idle mark                                                                 |
| Docs site                  | Static per-state SVGs (see open decisions)                                |

The sidebar stays as it is (D-62): no marks in list rows.

One React component, `LivingMark`, with `state` and `size` props, lives beside `MoonfoldMark.tsx`.
Web and desktop use it directly, and the Android app shows the web client, so it gets the same
one. Colours come from the existing palette roles and follow light and dark themes.

## Guardrails

- `prefers-reduced-motion`: the still pose for each state, no animation at all.
- Transforms and opacity only. No flashing: nothing changes faster than three times a second.
- Our own geometry only. Nothing is modelled on another product's mark or character.
- No new dependency.
- Contrast AA for every tint against both themes.

## Order of work

1. Geometry and generator, with tests for the generated data and the `--check` mode.
2. `LivingMark` with its five states and still poses; a browser test per state in real Chromium.
3. Composer and timeline adoption.
4. Skill icons in the skills manager and slash menu.
5. Review round card and council glyphs.
6. Welcome wizard, empty states, About.
7. Docs-site exports.
8. `docs/QA-MASCOT.md`: before and after captures, reduced-motion captures, a Chromium trace
   showing the working state does not repaint the page, and contrast numbers.

## Open decisions for the owner

1. **Name and personality.** Recommended: no cartoon name in the product. Internally "the living
   mark"; if you want a name, **Lune**. Personality: calm and attentive, never cute.
2. **Motion intensity.** Recommended: subtle. One lap of the ring takes about 2.4 seconds, the
   breath is 4 percent. The alternative is expressive (faster lap, larger sparkle, a ring wobble).
3. **Docs site.** Recommended: static exports. The site stays script-free and every state is
   readable there as a picture.

Out of scope: a floating desktop pet, per-feature mascots, provider-logo avatars, sound, a mascot
per skill.
