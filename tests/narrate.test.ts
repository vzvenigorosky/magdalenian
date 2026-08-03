import { describe, expect, it } from 'vitest';
import type { GeneratedScene } from '../src/sim/engine.ts';
import { assertsEmpty, narrateScene } from '../src/sim/narrate.ts';
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

  it('covers the emptiness-asserting lines actually present in the data', () => {
    const flagged = new Set<string>();
    const all = new Set<string>();
    for (const season of Object.values(defaultEvents)) {
      for (const hour of Object.values(season)) {
        for (const entry of hour) {
          all.add(entry.event);
          if (assertsEmpty(entry.event)) flagged.add(entry.event);
        }
      }
    }
    // Guards against a data edit introducing a new phrasing the patterns miss.
    expect(flagged.size, [...all].join('\n')).toBe(EMPTY_LINES.length);
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
