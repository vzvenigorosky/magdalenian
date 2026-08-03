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
| `npm run build:data` | Split `data/` into `public/data/` |
| `npm run build:icons` | Regenerate the PWA icons |

Smoke tests need a preview server already running:
`npm run build && npm run preview -- --port 4173 &` then `npm run test:smoke`.

## Data model

`data/` holds the source of truth and is **hand-authored content — do not
rewrite it programmatically.** `public/data/` is generated and gitignored.

| File | What it is |
| --- | --- |
| `magdalenian_year.json` | 365 days: metadata, 24 hourly weather rows, per-day `activitySuccessChance` |
| `magdalenian_locations.json` | 22 locations with weighted `activities` and `events` |
| `magdalenian_characters.json` | 43 people: `id`, `name`, `description0`..`description9` |
| `magdalenian_events.json` | Authored scenes, keyed day/hour/location |
| `magdalenian_default_events.json` | Fallback ambience per season/hour/location type |
| `character-profiles.json` | **Derived** age band and roles — see below |

### Two activity vocabularies

The single most important thing to know about this data: location activity
weights and day success chances use **different names for the same activities**.
Only 20 of 44 location keys match a success key exactly. `src/data/activity-map.ts`
reconciles them and is covered by tests that fail if the data drifts. Adding an
activity to a location means checking whether it needs a mapping entry.

Where several success keys map to one activity, the highest-scoring variant for
that day wins — this is what surfaces the real seasonal signal in the data
(`foragingHazelnuts` is 0 in summer and 70 in autumn) and gives narration a
specific noun ("fishing for salmon" rather than "fishing").

### Derived character profiles

`data/character-profiles.json` is generated once from the prose descriptions by
`scripts/build-data.ts`, then **checked in and hand-editable** — the build never
overwrites an existing file. Age comes from `description0` alone, which is a
consistent age descriptor for all 43 characters; scanning all ten descriptions
picks up mentions of other people and misclassifies parents as children. If you
correct a profile by hand, `tests/data-integrity.test.ts` will flag any edit
that contradicts `description0`.

## Simulation engine

`generateScene(day, hour, locationId)` resolves in strict order:

1. An authored event for that exact cell wins outright.
2. Otherwise a scene is generated from location weights × the hour's conditions,
   rolled against the day's success chances.
3. The season/hour/location-type ambience line always frames the scene.

**Generation is seeded from the coordinate and must stay deterministic.**
Revisiting a cell has to produce the identical scene; without that the world
reshuffles as you navigate and reads as broken. Tests enforce this.

Location incident weights are **per-day** percentages and are divided by 24
before rolling hourly, so `fatalFall` at 0.01% stays a once-in-a-lifetime event.

## Known data issues

- `magdalenian_default_events.json` is **identical across all four seasons** —
  all 192 season/hour/location-type entries repeat verbatim, so winter scenes
  can be framed with summer text ("the sun is high... resting in the shade").
  The file's season dimension currently carries no information. Left as-is
  because it is authored content; writing real seasonal variants is a content
  task, not a code fix.
- Authored events cover **day 1 only** (24 events, 7 of 22 locations). Every
  other cell is procedurally generated.
- Five success keys have no location weight anywhere (`huntingSeals`,
  `buildingHideTent`, `diggingStoragePit`, `craftingAtlatl`,
  `engravingWithBurin`) so nothing can select them. Listed in
  `UNMAPPED_SUCCESS_KEYS`; wiring them up means adding location weights.
- Location ids are sparse — `loc6`, `loc8`, `loc12` and others don't exist.
  Never assume a contiguous range.
