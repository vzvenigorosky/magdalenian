# Ambience source

`ambience.json` is the authored source for the fallback lines shown when a
day/hour/location cell has no hand-written event. It is keyed by

    locationType -> season -> phase

with six day-phases, which `scripts/build-data.ts` expands into the flat
24-hour structure `magdalenian_default_events.json` uses:

| Phase     | Hours          |
| --------- | -------------- |
| `night`   | 0–4, 22–23     |
| `dawn`    | 5–7            |
| `morning` | 8–11           |
| `midday`  | 12–16          |
| `evening` | 17–19          |
| `settle`  | 20–21          |

Editing here is the right place to change ambience: the flat file is generated.

Two properties the engine depends on, both covered by tests:

- A line that asserts nobody is present ("deserted", "no human activity") must
  be true of a place that can be empty — the narrator drops such a line when
  the scene names people.
- A line that asserts people are at work ("the foragers", "the band") forces
  the engine to staff that location, so use it only where it is plausible.
