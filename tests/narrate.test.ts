import { describe, expect, it } from 'vitest';
import type { GeneratedScene } from '../src/sim/engine.ts';
import { assertsEmpty, assertsPeoplePresent } from '../src/sim/ambience.ts';
import { narrateScene } from '../src/sim/narrate.ts';
import type { CharacterProfile } from '../src/types.ts';
import { defaultEvents } from './helpers.ts';

const actor = (id: string, name: string): CharacterProfile => ({
  id,
  name,
  ageBand: 'adult',
  roles: [],
  evidence: 'test fixture',
});

const scene = (activity: string, succeeded: boolean, successKey: string | null): GeneratedScene => ({
  kind: 'generated',
  ambience: 'The world is quiet here.',
  activities: [
    {
      activity,
      successKey,
      label: activity,
      chance: 50,
      succeeded,
      actors: [actor('char0', 'Zahar')],
    },
  ],
  incidents: [],
});

/** Phrases that imply an attempt that could have gone the other way. */
const OUTCOME_WORDS =
  /goes well|comes out|steady hands|spoiled|cracks|nothing usable|come back|they return|nothing to show|quarry does not|effort pays|eat better/i;

describe('outcome phrasing is limited to activities that can fail', () => {
  it('never narrates rest as success or failure', () => {
    for (const activity of ['restingEffectively', 'napping', 'deepSleep', 'meditatingOrTrance']) {
      for (const succeeded of [true, false]) {
        const html = narrateScene(scene(activity, succeeded, activity), `${activity}:${succeeded}`);
        expect(html, `${activity} narrated as an outcome`).not.toMatch(OUTCOME_WORDS);
      }
    }
  });

  it('never narrates social and care acts as success or failure', () => {
    for (const activity of ['childcare', 'gossiping', 'tellingStories', 'groupRitual', 'delousing']) {
      for (const succeeded of [true, false]) {
        const html = narrateScene(scene(activity, succeeded, 'childcare'), `${activity}:${succeeded}`);
        expect(html, `${activity} narrated as an outcome`).not.toMatch(OUTCOME_WORDS);
      }
    }
  });

  it('does narrate quarry and craft outcomes', () => {
    for (const activity of ['huntingRedDeer', 'knappingFlint', 'preparingHides', 'foragingNuts']) {
      const won = narrateScene(scene(activity, true, activity), `${activity}:win`);
      const lost = narrateScene(scene(activity, false, activity), `${activity}:lose`);
      expect(won).toMatch(OUTCOME_WORDS);
      expect(lost).toMatch(OUTCOME_WORDS);
      expect(won).not.toBe(lost);
    }
  });
});

describe('ambience that contradicts the scene', () => {
  const EMPTY_LINES = [
    'The area is deserted, the only sound is the wind or the flow of water.',
    'The natural sounds of the landscape fill the air. There is no human activity here.',
    'The landscape is quiet under the moon and stars, home only to nocturnal predators.',
    'The thickets and groves are silent, save for the rustle of small creatures.',
    "The area is quiet again, the only evidence of the day's activity are the disturbed plants.",
  ];

  /** Calm or half-empty, but perfectly compatible with people being present. */
  const COMPATIBLE_LINES = [
    'The site is quiet and still, holding a palpable sense of reverence. The wind whispers through the stones or leaves.',
    'The area is quiet and still under the night sky.',
    'The first light reveals fresh tracks in the dew-damp earth. The air is still and tense with anticipation.',
    'A quieter period in the main camp. Many are out foraging or hunting. Those who remain are napping or engaged in quiet craftwork.',
    'The foragers work steadily, sharing quiet conversation and teaching the younger ones which plants are safe to eat.',
  ];

  it('recognises lines that claim nobody is present', () => {
    for (const line of EMPTY_LINES) expect(assertsEmpty(line), line).toBe(true);
  });

  it('leaves merely calm lines alone', () => {
    for (const line of COMPATIBLE_LINES) expect(assertsEmpty(line), line).toBe(false);
  });

  it('drops the line when the scene names people at work', () => {
    for (const line of EMPTY_LINES) {
      const withPeople: GeneratedScene = { ...scene('knappingFlint', true, 'knappingFlint'), ambience: line };
      const html = narrateScene(withPeople, 'x');
      expect(html, line).not.toContain(line.slice(0, 30));
      expect(html).toContain('Zahar');
    }
  });

  it('keeps the line when the place really is empty', () => {
    for (const line of EMPTY_LINES) {
      const deserted: GeneratedScene = {
        kind: 'generated',
        ambience: line,
        activities: [],
        incidents: [],
      };
      expect(narrateScene(deserted, 'x'), line).toContain(line.slice(0, 30));
    }
  });

  it('always keeps compatible lines, activities or not', () => {
    for (const line of COMPATIBLE_LINES) {
      const withPeople: GeneratedScene = { ...scene('knappingFlint', true, 'knappingFlint'), ambience: line };
      expect(narrateScene(withPeople, 'x'), line).toContain(line.slice(0, 30));
    }
  });

  it('never leaves a scene with nothing to show', () => {
    for (const line of EMPTY_LINES) {
      const withPeople: GeneratedScene = { ...scene('knappingFlint', true, 'knappingFlint'), ambience: line };
      const text = narrateScene(withPeople, 'x').replace(/<[^>]+>/g, '').trim();
      expect(text.length, line).toBeGreaterThan(20);
    }
  });

  /** Every unique ambience string in the data, across all four seasons. */
  const allLines = (): string[] => {
    const seen = new Set<string>();
    for (const season of Object.values(defaultEvents)) {
      for (const hour of Object.values(season)) {
        for (const entry of hour) seen.add(entry.event);
      }
    }
    return [...seen];
  };

  it('covers the emptiness-asserting lines actually present in the data', () => {
    const flagged = allLines().filter(assertsEmpty);
    // Guards against a data edit introducing a new phrasing the patterns miss.
    expect(flagged.sort()).toEqual([...EMPTY_LINES].sort());
  });

  it('sorts every line in the data into exactly one of the three kinds', () => {
    const lines = allLines();
    expect(lines).toHaveLength(23);

    const both = lines.filter((l) => assertsEmpty(l) && assertsPeoplePresent(l));
    expect(both, 'a line cannot claim both empty and occupied').toEqual([]);

    const empty = lines.filter(assertsEmpty).length;
    const people = lines.filter(assertsPeoplePresent).length;
    const neutral = lines.length - empty - people;
    expect({ empty, people, neutral }).toEqual({ empty: 5, people: 14, neutral: 4 });
  });

  it('reads the busy lines as occupied', () => {
    for (const line of [
      'A hunting party moves silently through the area, eyes scanning for any sign of game.',
      'The band gathers as hunters and foragers return. The sounds of conversation and food preparation fill the air.',
      'The dwelling is a hub of activity. Children play under the watchful eyes of elders, while artisans work on hides and tools.',
      'Individuals or small groups come and go, collecting water, quarrying flint, or searching the shoreline for useful items.',
    ]) {
      expect(assertsPeoplePresent(line), line).toBe(true);
    }
  });

  it('does not read neutral scene-setting as occupied', () => {
    for (const line of [
      'The area is damp with dew. Birds begin to call from the branches.',
      'The area is quiet and still under the night sky.',
      'The site is quiet and still, holding a palpable sense of reverence. The wind whispers through the stones or leaves.',
    ]) {
      expect(assertsPeoplePresent(line), line).toBe(false);
    }
  });
});

describe('childminding phrasing', () => {
  const minding = (minders: CharacterProfile[], charges: CharacterProfile[]): GeneratedScene => ({
    kind: 'generated',
    ambience: 'The area is damp with dew.',
    activities: [
      {
        activity: 'childcare',
        successKey: null,
        label: 'minding the children',
        chance: 100,
        succeeded: true,
        actors: minders,
        charges,
      },
    ],
    incidents: [],
  });

  const child = (id: string, name: string): CharacterProfile => ({
    id,
    name,
    ageBand: 'child',
    roles: [],
    evidence: 'test fixture',
  });

  const text = (scene: GeneratedScene, seed: string) =>
    narrateScene(scene, seed).replace(/<[^>]+>/g, '');

  it('agrees the verb with a single minder across every phrasing', () => {
    for (let seed = 0; seed < 40; seed++) {
      const line = text(minding([actor('a', 'Pello')], [child('c', 'Txiki')]), `s${seed}`);
      expect(line, line).toMatch(/Pello (keeps an eye on|watches over|stays close to) Txiki\./);
    }
  });

  it('agrees the verb with several minders across every phrasing', () => {
    for (let seed = 0; seed < 40; seed++) {
      const line = text(
        minding([actor('a', 'Lurra'), actor('b', 'Bor')], [child('c', 'Txiki')]),
        `s${seed}`,
      );
      expect(line, line).toMatch(/Lurra and Bor (keep an eye on|watch over|stay close to) Txiki\./);
    }
  });

  it('names every child being minded', () => {
    const line = text(
      minding([actor('a', 'Lurra')], [child('c1', 'Sua'), child('c2', 'Ekain'), child('c3', 'Zuri')]),
      'x',
    );
    expect(line).toContain('Sua, Ekain and Zuri');
  });

  it('gives the children tooltips of their own', () => {
    const html = narrateScene(minding([actor('a', 'Lurra')], [child('c1', 'Sua')]), 'x');
    expect(html).toContain('data-char-id="c1"');
  });

  it('never narrates minding as a success or failure', () => {
    for (let seed = 0; seed < 20; seed++) {
      expect(text(minding([actor('a', 'Lurra')], [child('c', 'Sua')]), `s${seed}`)).not.toMatch(
        OUTCOME_WORDS,
      );
    }
  });
});

describe('markup', () => {
  it('wraps actors in tooltip-bearing spans', () => {
    const html = narrateScene(scene('knappingFlint', true, 'knappingFlint'), 'x');
    expect(html).toContain('class="character-name" data-char-id="char0"');
    expect(html).toContain('Zahar');
  });

  it('escapes text drawn from the data', () => {
    const hostile: GeneratedScene = {
      kind: 'generated',
      ambience: '<script>alert(1)</script>',
      activities: [],
      incidents: [],
    };
    const html = narrateScene(hostile, 'x');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('joins multiple actors readably', () => {
    const many: GeneratedScene = {
      ...scene('gossiping', true, null),
      activities: [
        {
          activity: 'gossiping',
          successKey: null,
          label: 'trading gossip',
          chance: 100,
          succeeded: true,
          actors: [actor('c1', 'Aitor'), actor('c2', 'Bor'), actor('c3', 'Sua')],
        },
      ],
    };
    const text = narrateScene(many, 'x').replace(/<[^>]+>/g, '');
    expect(text).toContain('Aitor, Bor and Sua are trading gossip.');
  });

  it('marks grave incidents differently from ordinary ones', () => {
    const withIncidents: GeneratedScene = {
      ...scene('gossiping', true, null),
      incidents: [
        { key: 'toolBreakage', label: 'a broken tool', grave: false },
        { key: 'fatalFall', label: 'a fatal fall', grave: true },
      ],
    };
    const html = narrateScene(withIncidents, 'x');
    expect(html).toContain('text-amber-300');
    expect(html).toContain('text-red-400');
  });
});
