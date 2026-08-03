import { describe, expect, it } from 'vitest';
import type { GeneratedScene } from '../src/sim/engine.ts';
import { narrateScene } from '../src/sim/narrate.ts';
import type { CharacterProfile } from '../src/types.ts';

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
