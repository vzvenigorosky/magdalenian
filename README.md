# Magdalenian Observer

An interactive observer for a simulated year in the life of a Magdalenian
hunter-gatherer band. Pick a season, a day, an hour and a place, and see what
the band is doing there.

Every one of the 365 days is browsable. Where a scene has been written by hand
it is shown as written; everywhere else the scene is generated from the
location's activity weights, the day's success chances, and that hour's
weather — so a hunting ground at midday in winter reads differently from the
same valley at 3am in summer. Scenes are seeded from their coordinates, so a
given day, hour and place always shows the same thing.

## Running it

```bash
npm install
npm run dev
```

Then open the printed URL.

```bash
npm test          # unit and data-integrity suite
npm run build     # typecheck + production build to dist/
npm run preview   # serve the build at /magdalenian/
```

The browser smoke test runs against a preview server:

```bash
npm run build && npm run preview -- --port 4173 &
npm run test:smoke
```

## How it fits together

```
data/              hand-authored source datasets
scripts/           build-data (splits the year file), icon generator, smoke test
public/data/       generated at build time, gitignored
src/
  data/            loader, and the activity-vocabulary mapping
  sim/             seeded RNG, condition weighting, scene engine, narration
  ui/              time nav, location nav, scene view, tooltips
tests/             Vitest suite
```

The year file is 1.76 MB, so the build splits it into a 126 KB day-level index
loaded upfront and four per-season detail chunks fetched on demand. The app is
an installable PWA and works offline once visited.

See [CLAUDE.md](CLAUDE.md) for the data model, the engine's resolution order,
and known data issues.
