# Magdalenian Observer

An interactive observer for a simulated year in the life of a Magdalenian
hunter-gatherer band. Static web app / installable PWA, no backend.

## Stack and conventions

These are the project's settled preferences — follow them unless asked otherwise.

- **Vite + TypeScript + Vitest.** Static build, deployed to GitHub Pages.
- **TypeScript is strict**, including `noUncheckedIndexedAccess`. Index access
  yields `T | undefined`; handle it rather than asserting it away.
- **No CDN dependencies.** Tailwind (v4, via `@tailwindcss/vite`) and both fonts
  are self-hosted through npm. The app must work fully offline.
- **Tests are Vitest, in `tests/`, node environment.** Simulation logic is pure
  and directly testable; keep it that way. Browser checks live in
  `scripts/smoke.ts` and are run separately (`npm run test:smoke`) so the unit
  suite stays browser-free.
- Prefer porting existing behaviour over rewriting it. Authored content must
  keep rendering exactly as it did.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server (regenerates `public/data/` first) |
| `npm test` | Vitest suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve `dist/` at `/magdalenian/` |
| `npm run test:smoke` | Playwright checks against a running preview server |
| `npm run build:data` | Regenerate `public/data/` from `data/` |
| `npm run build:icons` | Regenerate the PWA icons |

Smoke tests need a preview server already running:
`npm run build && npm run preview -- --port 4173 &` then `npm run test:smoke`.

## Data model

`data/` holds the source of truth. **Hand-authored content — do not rewrite it
programmatically.** `public/data/` is generated and gitignored.

| File | What it is |
| --- | --- |
| `magdalenian_year.json` | 365 days: metadata, 24 hourly weather rows, tide table, per-day `activitySuccessChance` |
| `magdalenian_locations.json` | 22 locations with weighted `activities` and `events` |
| `magdalenian_characters.json` | 43 people: `id`, `name`, `description0`..`description9` |
| `magdalenian_events.json` | Authored scenes, keyed day/hour/location |
| `ambience/ambience.json` | Fallback ambience, authored per type/season/phase |
| `character-profiles.json` | **Derived** age band and roles |
| `relationships.json` | **Derived** kinship graph |

The two derived files are generated once by `scripts/build-data.ts`, then
**checked in and hand-editable** — the build never overwrites an existing file.
Tests flag hand edits that contradict the source prose.

### Two activity vocabularies

The single most important thing to know about this data: location activity
weights and day success chances use **different names for the same activities**.
Only 20 of 44 location keys match a success key exactly. `src/data/activity-map.ts`
reconciles them and is covered by tests that fail if the data drifts. Adding an
activity to a location means checking whether it needs a mapping entry.

Where several success keys map to one activity, the highest-scoring variant for
that day wins — this surfaces the seasonal signal already in the data
(`foragingHazelnuts` is 0 in summer and 70 in autumn).

Some variants must be chosen by **light level instead of score**, via
`nightVariant` / `dimVariant`. Rest is the case in point: `napping` scores 75
against `restingEffectively`'s 80 every day of the year, so under the
highest-score rule it could never be selected. Watch for this trap whenever
adding a variant: being *mapped* is not the same as being *selectable*, and
`tests/activity-map.test.ts` asserts the stronger property. All 38 success keys
are currently reachable and a test holds it that way.

### Ambience

`data/ambience/ambience.json` is authored as **8 location types × 4 seasons × 6
day-phases = 192 lines**, expanded by `src/data/ambience-source.ts` into the
season/hour/type shape the app reads. Editing ambience means editing that file;
the flat form is generated.

Every line **declares** what it claims about who is present — `empty`, `people`
or `neutral` — rather than the code inferring it from the prose. The engine will
not empty a location whose line says it is busy, and the narrator drops an
"empty" line when the scene names people anyway. The old prose-matching
patterns survive in `src/sim/ambience.ts` only as a fallback for undeclared
entries.

### Kinship

`relationships.json` is read out of the descriptions, which state family plainly
("She is the mate of Aitor and mother of Sua", "He is Ines's eldest son").
Relations are stored symmetrically, and siblings and grandparents are inferred
from shared parents even where no line says so. Five characters have no kin,
which is correct — Gizon "came from another band".

## Simulation engine

`generateScene(day, hour, locationId)` resolves in strict order:

1. An authored event for that exact cell wins outright.
2. Otherwise a scene is generated from location weights × the hour's conditions,
   rolled against the day's success chances.
3. The season/hour/type ambience line frames the scene.

**Generation is seeded from the coordinate and must stay deterministic.**
Revisiting a cell has to produce the identical scene; without that the world
reshuffles as you navigate and reads as broken. Tests enforce this.

Location incident weights are **per-day** percentages and are divided by 24
before rolling hourly, so `fatalFall` at 0.01% stays a once-in-a-lifetime event.

### Occupancy

Places are not staffed around the clock. `presenceChance` (`src/sim/weights.ts`)
decides whether anyone is at a location at all, driven mostly by distance from
camp and darkness — the central dwelling is always occupied, the Open Steppe
4.5 km out is empty about 89% of the time at 3am. About half of all generated
cells are empty, and that is the point: it is what makes the deserted-place
ambience true.

### Sky and sea

`src/sim/sky.ts` puts three previously unused fields to work:

- **Tides.** The 365 tide tables give a per-hour state, and shore work is gated
  on it — shellfish gathering runs at 19% of cells at low water against 3% at
  high. Tidal *range* is derived from the moon phase, not from the data's own
  amplitude fields; see Known data issues.
- **Moonlight.** A full moon partly lifts the penalty on being outdoors and on
  fine work after dark, and washes out a meteor shower.
- **Cosmic events.** The 13 marked days pull people to the sky or to rite —
  about 9.5× the sky-watching of an ordinary night — and get a closing line.

### Who can be doing what

Enforced in `eligibleActors` and `enforceSupervision` (`src/sim/engine.ts`), and
covered by tests that sweep the grid rather than spot-check:

- **Infants are never actors.** Listed in `NON_ACTORS`.
- **Children are never alone.** Supervision is judged across the whole scene, so
  a child foraging near a working adult counts.
- **Adolescents need no chaperone** but are barred from `strenuous` and
  `adultOnly` work.
- **`adultOnly` means adults *and elders*.**
- **Nobody does two jobs at once**, childminding excepted — see below.
- **Nobody is somewhere they could not have walked to.** `canReach` uses the
  `childWalkMinutes` / `elderWalkMinutes` fields: children stay within 15
  child-minutes of camp, adolescents 55, elders 40 elder-minutes. Adults go
  anywhere.

### Families in scenes

Kinship steers who appears together. Mates are near-exclusively paired for
intimacy (93% of pairs, and close kin are **hard-blocked**, not merely
disfavoured), parents mind their own children (73%), and elders teach their own
grandchildren. The multipliers in `KIN_AFFINITY` look extreme because they
compete against the whole band — a 12× boost for the one mate among 42 others
still only lands at ~22%.

For pairings that should be between mates, the *first* actor is drawn from
people whose mate is free; boosting only the second pick cannot make a couple if
the first person drawn has no mate present.

### Childminding

`childcare` is resolved **last**, in `buildChildcare`, because it depends on who
else is present and above all on whether there are children here at all.

- The scene gains a **`charges`** list — the children being minded. Infants
  appear here and only here.
- Minders are capped by `minderCap`: **≤2 grown-ups for 1–4 children, ≤3 for
  5–8, ≤4 beyond**, drawn from that range so one adult minding four is common.
- Childminding with no children present is dropped entirely.
- **Minders may also be working** — it is a background task. Excluded only from
  `strenuous` or `outdoor` work.

`teachingChild` works the same way: it is `adultOnly`, so the pupil is a charge
rather than an actor. Without that it produced two adults teaching nobody.

## Narration

`src/sim/narrate.ts` renders a scene. Phrasing comes from small pools chosen
with the scene's own seeded RNG, so wording is as stable as the scene.

- Only `quarry` and `craft` are attempts that can visibly fail. Rest and social
  acts carry a success chance in the data but narrating them as pass/fail gives
  nonsense like "sleeping deeply. Steady hands, and it holds."
- Conditions are woven in from `scene.conditions` — cold, rain, moonlight, tide,
  failing light — on about 45% of lines. Never two qualifiers on one line.
- Childminding and teaching name the children, so the ratio is visible.

## UI

Three panes, plus a character index. State lives in the URL as `#/d200/h13/loc22`,
so scenes are shareable and the back button works. Arrow keys step the hour and
day (rolling over midnight), `[` and `]` step location, `?` opens the index.

## Known data issues

- **Both tide-amplitude fields are unreliable.** `tideAmplitudeName` is
  uncorrelated noise — Spring, Normal and Neap days all average an amplitude
  near 1.0 across the full range. `tideAmplitudeValue` tracks lunar
  *illumination*, not tidal range: it peaks at Full Moon and bottoms at New
  Moon, whereas real spring tides occur at both. `tidalRange()` derives the
  range from the moon phase instead.
- **Eight tide times are written `HH:60`** (day 80's high water is `03:60`), a
  minute-rollover bug. `parseClock` rolls them over rather than editing the data.
- Authored events cover **day 1 only** (24 events, 7 of 22 locations).
- Location ids are sparse — `loc6`, `loc8`, `loc12` and others don't exist.
  Never assume a contiguous range.
