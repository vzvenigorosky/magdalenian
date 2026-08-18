import { describe, expect, it } from 'vitest';
import type { GeneratedScene, SceneConditions } from '../src/sim/engine.ts';
import { assertsEmpty, assertsPeoplePresent, toAmbience } from '../src/sim/ambience.ts';
import { narrateScene } from '../src/sim/narrate.ts';
import type { CharacterProfile } from '../src/types.ts';

const actor = (id: string, name: string): CharacterProfile => ({
  id,
  name,
  ageBand: 'adult',
  roles: [],
  evidence: 'test fixture',
});

/** Flat, featureless conditions so tests are not perturbed by weather clauses. */
const PLAIN: SceneConditions = {
  season: 'Summer',
  hour: 12,
  temp: 15,
  precip: 0,
  sunExposure: 'High',
  wind: 'Calm',
  moonlight: 0,
  cosmicEvent: 'None',
  tide: null,
};

const scene = (activity: string, succeeded: boolean, successKey: string | null): GeneratedScene => ({
  kind: 'generated',
  conditions: PLAIN,
  ambience: toAmbience('The world is quiet here.'),
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
  const empty = (text: string): GeneratedScene => ({
    kind: 'generated',
    conditions: PLAIN,
    ambience: { text, presence: 'empty' },
    activities: [],
    incidents: [],
  });

  const withPeople = (text: string, presence: 'empty' | 'people' | 'neutral'): GeneratedScene => ({
    ...scene('knappingFlint', true, 'knappingFlint'),
    ambience: { text, presence },
  });

  it('drops an emptiness claim when the scene names people at work', () => {
    const line = 'Nothing moves out here but wind over old snow.';
    const html = narrateScene(withPeople(line, 'empty'), 'x');
    expect(html).not.toContain(line.slice(0, 25));
    expect(html).toContain('Zahar');
  });

  it('keeps the claim when the place really is empty', () => {
    const line = 'Nothing moves out here but wind over old snow.';
    expect(narrateScene(empty(line), 'x')).toContain(line.slice(0, 25));
  });

  it('keeps neutral and people-bearing lines regardless', () => {
    for (const presence of ['neutral', 'people'] as const) {
      const line = 'The foragers work along the thickets.';
      expect(narrateScene(withPeople(line, presence), 'x'), presence).toContain(line.slice(0, 25));
    }
  });

  it('never leaves a scene with nothing to show', () => {
    const text = narrateScene(withPeople('Nothing moves out here.', 'empty'), 'x')
      .replace(/<[^>]+>/g, '')
      .trim();
    expect(text.length).toBeGreaterThan(20);
  });

  it('falls back to reading the prose when no presence is declared', () => {
    // Legacy path: entries without an explicit claim are still classified.
    expect(assertsEmpty('The area is deserted, the only sound is the wind.')).toBe(true);
    expect(assertsPeoplePresent('A hunting party moves silently through the area.')).toBe(true);
    expect(assertsEmpty('The area is quiet and still under the night sky.')).toBe(false);
    expect(assertsPeoplePresent('The area is damp with dew.')).toBe(false);
  });
});

describe('childminding phrasing', () => {
  const minding = (minders: CharacterProfile[], charges: CharacterProfile[]): GeneratedScene => ({
    kind: 'generated',
    conditions: PLAIN,
    ambience: toAmbience('The area is damp with dew.'),
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

describe('conditions woven into the prose', () => {
  const withConditions = (overrides: Partial<SceneConditions>): GeneratedScene => ({
    ...scene('knappingFlint', true, 'knappingFlint'),
    conditions: { ...PLAIN, ...overrides },
  });

  const textOf = (s: GeneratedScene, seed: string) => narrateScene(s, seed).replace(/<[^>]+>/g, '');

  /** Across many seeds, does any line ever carry one of these phrasings? */
  const everSays = (overrides: Partial<SceneConditions>, pattern: RegExp) => {
    for (let seed = 0; seed < 60; seed++) {
      if (pattern.test(textOf(withConditions(overrides), `s${seed}`))) return true;
    }
    return false;
  };

  it('mentions rain when it is raining', () => {
    expect(everSays({ precip: 8 }, /driving rain|has not let up|soaked through/i)).toBe(true);
  });

  it('mentions the cold when it is freezing', () => {
    expect(everSays({ temp: -10 }, /stops the breath|frozen iron-hard|cracks stone/i)).toBe(true);
  });

  it('distinguishes working by a full moon from working blind', () => {
    expect(everSays({ sunExposure: 'Dark', moonlight: 1 }, /moon/i)).toBe(true);
    expect(everSays({ sunExposure: 'Dark', moonlight: 0 }, /in the dark|by feel|firelight/i)).toBe(true);
  });

  it('mentions the tide only at the shore', () => {
    expect(everSays({ tide: 'low' }, /water far out|uncovered shore/i)).toBe(true);
    expect(everSays({ tide: null }, /water far out|uncovered shore/i)).toBe(false);
  });

  it('says nothing about conditions when there is nothing to say', () => {
    for (let seed = 0; seed < 40; seed++) {
      const text = textOf(withConditions({}), `s${seed}`);
      expect(text, text).not.toMatch(/rain|frost|moon|shore|heat of the day/i);
    }
  });

  it('never stacks two qualifiers on one line', () => {
    for (let seed = 0; seed < 80; seed++) {
      const text = textOf(withConditions({ precip: 9, temp: -12, sunExposure: 'Dark' }), `s${seed}`);
      const line = text.split('.')[1] ?? '';
      expect(line.split(',').length, line).toBeLessThan(3);
    }
  });

  it('stays deterministic for a given seed', () => {
    const s = withConditions({ precip: 8, temp: -3 });
    expect(narrateScene(s, 'fixed')).toBe(narrateScene(s, 'fixed'));
  });

  it('marks the cosmic days and leaves ordinary days unmarked', () => {
    const meteors = textOf(withConditions({ cosmicEvent: 'Perseids Meteor Shower (Peak)' }), 'x');
    expect(meteors).toMatch(/sky will burn|streaks of fire/i);
    expect(meteors).not.toContain('(Peak)');

    expect(textOf(withConditions({ cosmicEvent: 'Winter Solstice' }), 'x')).toMatch(
      /shortest day.*light begins to come back/i,
    );
    expect(textOf(withConditions({ cosmicEvent: 'Summer Solstice' }), 'x')).toMatch(
      /longest day.*light begins to go/i,
    );
    expect(textOf(withConditions({ cosmicEvent: 'Passing Comet Sighting' }), 'x')).toMatch(
      /hairy star/i,
    );
    expect(textOf(withConditions({ cosmicEvent: 'None' }), 'x')).not.toMatch(/hairy star|sky will burn/i);
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
      conditions: PLAIN,
      ambience: toAmbience('<script>alert(1)</script>'),
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
