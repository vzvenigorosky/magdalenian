# Writing scenes

A hand-written scene replaces whatever the engine would otherwise have
generated for one day, one hour, one place. Everything else stays generated, so
you can write ten scenes or ten thousand and the year still holds together.

One file per day, named for the day: `day-001.json`, `day-200.json`.

## The shortest possible scene

```json
{
  "day": 200,
  "scenes": [
    {
      "hour": 13,
      "at": "The Whispering Valley",
      "text": "The tracks are three hours old and going the wrong way."
    }
  ]
}
```

Use the names that appear in the app — `"The Whispering Valley"`, not `loc22`.
The build resolves them, and tells you if you get one wrong.

## A scene with talking

```json
{
  "hour": 7,
  "at": "The Cave Mouth",
  "narration": "Low sun on the cave entrance. The children are still knuckling sleep out of their eyes.",
  "dialogue": [
    { "speaker": "Goizane", "line": "The fire held. Rise, and let us break the fast." },
    { "speaker": "Sua", "line": "Can we go to the stream today? Gorka saw a frog." }
  ]
}
```

A scene is prose **or** dialogue, never both.

## Anything called `_note` is ignored

JSON has no comments, so `_note` stands in for one. Put whatever you like there
— the scaffolding command fills it with the weather.

```json
{ "hour": 13, "at": "The High Peak", "_note": "Winter, midday · -15°C · Biting wind", "text": "..." }
```

## The commands

```bash
npm run events -- suggest                              # days worth writing, and why
npm run events -- context 200 13 "The Whispering Valley"
npm run events -- new 200 13 "The Whispering Valley"   # add --dialogue for a talking scene
npm run events -- check                                # validate everything
npm run events -- coverage                             # what is written so far
```

`context` is the one to reach for first. It prints what the engine already
knows about that cell — the weather, the light, the tide, the moon, who is near
enough to be standing there, and the scene it would generate if you wrote
nothing. Writing against that keeps a scene consistent with the world around it.

`check` runs on every build too, so a typo fails the build rather than
silently dropping a scene. It reports every problem at once and suggests
corrections:

```
day 300, scene 1 (hour 21): unknown place "The Pained Cave" — did you mean "The Painted Cave"?
day 300, scene 2, line 1: unknown speaker "Gozane" — did you mean "Goizane"?
```

## Things worth knowing

- **An authored scene wins outright.** The ambience line and generated activity
  are both replaced. You are writing the whole cell.
- **Nothing checks plausibility for you.** The engine will not let a child walk
  to The Open Steppe, but you can put one there in prose. `context` shows who
  is near enough, so you can decide deliberately rather than by accident.
- **Character names in prose are not linked.** Only speakers in `dialogue` get
  the hover tooltip. Prose is rendered as written.
- Location ids are sparse and names are the interface; you never need the ids.
