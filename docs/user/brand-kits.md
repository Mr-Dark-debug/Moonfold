# Brand kits with Cassandre

Cassandre turns one prompt into a brand kit: a name, a logo set, colors with roles for light and
dark, type with a hierarchy, spacing and radius, voice and tone, ready-to-use exports, and a brand
book page. Everything it makes is saved in your project under `.moonfold/brand/`.

## Start one

In any thread, start your message with `/brand` and describe what you are building:

```
/brand a calm budgeting app for students
```

You can also type `/` and choose **/brand** from the menu. Any agent that has Moonfold's tools can
run it. The thread switches to the **Cassandre (brand kit)** prompt profile, so follow-up messages
keep working on the kit. Switch the profile back from the thread menu when you are done.

## What it asks you

Cassandre stops and asks with a question card instead of guessing. Answer in the card; the agent
continues as soon as you submit.

- **The brief**: who it is for, three personality words, competitors to stand apart from, and
  anything to avoid.
- **How many designs**: choose 2 to 5 directions to explore.
- **References**: let it search design galleries such as Dribbble, Pinterest and Behance for you,
  send your own, or skip them. It may ask whether to research more if what it found is thin.
- **The name**, when you don't have one, with domain, GitHub and npm availability for each
  candidate. Availability is not a trademark check; use the search link it gives you.
- **The direction**: each design is shown as a picture together with the references it builds on.
  Pick one, or describe how to mix them.
- **Applying it**: at the end, whether to wire the colors and type into your project's code.
  Nothing in your code changes unless you say yes.

## What you get

| Folder                          | What is in it                                                          |
| ------------------------------- | ---------------------------------------------------------------------- |
| `brief.md`, `plan.md`           | What you asked for and the steps it followed                           |
| `name/`                         | Name candidates, availability checks and the decision                  |
| `references/`                   | The references it kept, with screenshots and its notes                 |
| `directions/`                   | Each design direction and its picture                                  |
| `tokens/`                       | `tokens.json`, the single source of truth for colors, type and spacing |
| `color/`, `type/`, `voice/`     | Palette and contrast, type scale and roles, tone of voice              |
| `logo/`, `icons/`, `templates/` | Logo variants, app icon sizes, social images                           |
| `fonts/`                        | The fonts used, each with its open-source license                      |
| `exports/`                      | CSS variables, a Tailwind theme, SCSS, TypeScript and JSON             |
| `guidelines/`                   | The brand book page                                                    |
| `reviews/`                      | Each review round: who scored what, with a glyph per reviewer          |

Moonfold checks the kit before exporting: text colors must meet WCAG AA contrast, logos must be
plain SVG, and every font needs an open-source license. `exports/` is generated from `tokens.json`,
so edit the tokens and ask for a new export instead of editing the exports.

## Good to know

- References are for inspiration only. Cassandre does not copy, trace or imitate them, and the
  `references/` folder is kept out of git because the screenshots belong to their authors.
- Searching galleries uses Moonfold's browser and its [agent browsing](agent-browsing.md) rules.
  Some sites, Pinterest among them, do not allow automated browsing in their terms; block them
  there if you prefer to collect references yourself.
- A kit can be resumed later, or continued by another agent after a usage limit. Its progress is
  in `.moonfold/brand/brand.json`.
