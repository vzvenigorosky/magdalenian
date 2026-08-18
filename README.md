# Magdalenian Observer

An interactive observer for a simulated year in the life of a Magdalenian
hunter-gatherer band. Pick a season, a day, an hour and a place, and see what
the band is doing there.

Every one of the 365 days is browsable. Where a scene has been written by hand
it is shown as written; everywhere else it is generated from the location's
activity weights, the day's success chances, the hour's weather, the state of
the tide and the phase of the moon — so a hunting ground at midday in winter
reads differently from the same valley at 3am in summer. Scenes are seeded from
their coordinates, so a given day, hour and place always shows the same thing.

The band is a band of families. Kinship is read out of the characters'
descriptions, so mates lie together, parents mind their own children, and an
elder teaches his own grandchildren. Children stay within walking distance of
camp and are never left unsupervised; infants are carried, never workers.

Navigate with the arrow keys — left and right for hours, up and down for days,
`[` and `]` for places, `?` for the index of the band. Every scene has its own
URL, so any moment can be bookmarked or shared.

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
  ambience/        the 192 ambience lines, by type, season and day-phase
scripts/           build-data, icon generator, browser smoke test
public/data/       generated at build time, gitignored
src/
  data/            loader, activity-vocabulary mapping, ambience expansion
  sim/             seeded RNG, weighting, sky and tides, engine, narration
  ui/              navigation, scene view, character index, router, keyboard
tests/             Vitest suite
```

The year file is 1.76 MB, so the build splits it into a 126 KB day-level index
loaded upfront and four per-season detail chunks fetched on demand. The app is
an installable PWA and works offline once visited.

See [CLAUDE.md](CLAUDE.md) for the data model, the engine's resolution order,
and known data issues.
