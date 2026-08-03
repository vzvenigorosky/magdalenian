import { describe, expect, it } from 'vitest';
import type { ResolvedDay } from '../src/types.ts';
import { findAmbience, generateScene, type GeneratedScene, type SceneInput } from '../src/sim/engine.ts';
import { narrateScene } from '../src/sim/narrate.ts';
import { traitsOf } from '../src/sim/weights.ts';
import { dayOf, defaultEvents, events, locations, profiles, year } from './helpers.ts';

const asDay = (n: number) => dayOf(n) as unknown as ResolvedDay;

function sceneInput(day: number, hour: number, locationId: string): SceneInput {
  const location = locations[locationId]!;
  const resolved = asDay(day);
  return {
    day: resolved,
    hour,
    location,
    profiles,
    authored: events.schedule,
    ambience: findAmbience(defaultEvents, resolved.season, hour, location.type),
  };
}

/** Asserts the cell is procedurally generated. Only use on cells with no authored event. */
const generate = (day: number, hour: number, loc: string): GeneratedScene => {
  const scene = generateScene(sceneInput(day, hour, loc));
  if (scene.kind !== 'generated') throw new Error(`${day}:${hour}:${loc} is authored`);
  return scene;
};

/** For sweeps that cross day 1, where some cells legitimately are authored. */
const generateIfAny = (day: number, hour: number, loc: string): GeneratedScene | null => {
  const scene = generateScene(sceneInput(day, hour, loc));
  return scene.kind === 'generated' ? scene : null;
};

describe('authored events take precedence', () => {
  it('returns the authored event for every cell that has one', () => {
    for (const authored of events.schedule) {
      const scene = generateScene(sceneInput(authored.day, authored.hour, authored.location));
      expect(scene.kind).toBe('authored');
      if (scene.kind === 'authored') expect(scene.event).toEqual(authored);
    }
  });

  it('generates for a cell with no authored event', () => {
    // Day 1 hour 0 is authored at loc0 but nowhere else.
    expect(generateScene(sceneInput(1, 0, 'loc0')).kind).toBe('authored');
    expect(generateScene(sceneInput(1, 0, 'loc33')).kind).toBe('generated');
  });

  it('still provides ambience alongside an authored event', () => {
    const scene = generateScene(sceneInput(1, 0, 'loc0'));
    expect(scene.ambience.length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('produces an identical scene for the same coordinate', () => {
    for (const [day, hour, loc] of [
      [200, 14, 'loc22'],
      [100, 3, 'loc23'],
      [45, 21, 'loc0'],
    ] as const) {
      expect(generate(day, hour, loc)).toEqual(generate(day, hour, loc));
    }
  });

  it('produces identical narration for the same coordinate', () => {
    const a = narrateScene(generate(200, 14, 'loc22'), '200:14:loc22');
    const b = narrateScene(generate(200, 14, 'loc22'), '200:14:loc22');
    expect(a).toBe(b);
  });

  it('produces different scenes for different coordinates', () => {
    const scenes = new Set(
      [
        [200, 14, 'loc22'],
        [201, 14, 'loc22'],
        [200, 15, 'loc22'],
        [200, 14, 'loc33'],
      ].map(([d, h, l]) => JSON.stringify(generate(d as number, h as number, l as string))),
    );
    expect(scenes.size).toBe(4);
  });
});

describe('conditions shape what happens', () => {
  it('suppresses outdoor work in darkness', () => {
    let darkOutdoor = 0;
    let lightOutdoor = 0;
    for (let day = 1; day <= 365; day += 5) {
      for (const hour of [2, 3]) {
        darkOutdoor += generate(day, hour, 'loc22').activities.filter((a) => traitsOf(a.activity).outdoor)
          .length;
      }
      for (const hour of [12, 13]) {
        lightOutdoor += generate(day, hour, 'loc22').activities.filter((a) => traitsOf(a.activity).outdoor)
          .length;
      }
    }
    expect(lightOutdoor).toBeGreaterThan(darkOutdoor * 2);
  });

  it('only ever shows stargazing after dark', () => {
    for (let day = 1; day <= 365; day += 3) {
      const resolved = asDay(day);
      for (let hour = 0; hour < 24; hour++) {
        const stargazing = generate(day, hour, 'loc7').activities.some(
          (a) => a.activity === 'stargazing',
        );
        if (stargazing) {
          expect(resolved.hourly.find((h) => h.hour === hour)!.sunExposure).toBe('Dark');
        }
      }
    }
  });

  it('reflects the seasonal success signal in the data', () => {
    // foragingHazelnuts: 0 in summer, 70 in autumn.
    const summerDay = year.find((d) => d.season === 'Summer')!.day;
    const autumnDay = year.find((d) => d.season === 'Autumn')!.day;
    const nutChance = (day: number) =>
      generate(day, 12, 'loc14').activities.find((a) => a.activity === 'foragingNuts')?.chance;
    // Only assert when the activity is actually drawn on that day.
    const summerChance = nutChance(summerDay);
    if (summerChance !== undefined) expect(summerChance).toBe(0);
    const autumnChance = nutChance(autumnDay);
    if (autumnChance !== undefined) expect(autumnChance).toBeGreaterThan(0);
  });
});

describe('actor assignment', () => {
  it('keeps children and elders out of strenuous work', () => {
    for (let day = 1; day <= 365; day += 4) {
      for (const hour of [8, 12, 16]) {
        for (const loc of ['loc22', 'loc33', 'loc45', 'loc65']) {
          for (const activity of generate(day, hour, loc).activities) {
            if (!traitsOf(activity.activity).strenuous) continue;
            for (const actor of activity.actors) {
              expect(actor.ageBand, `${actor.name} on ${activity.activity}`).toBe('adult');
            }
          }
        }
      }
    }
  });

  it('assigns at least one actor to every activity', () => {
    for (let day = 1; day <= 365; day += 11) {
      for (const hour of [6, 18]) {
        for (const activity of generateIfAny(day, hour, 'loc0')?.activities ?? []) {
          expect(activity.actors.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('favours characters whose derived roles fit the activity', () => {
    let hunterMatches = 0;
    let total = 0;
    for (let day = 1; day <= 365; day += 2) {
      for (const activity of generate(day, 11, 'loc22').activities) {
        if (!activity.activity.startsWith('hunting')) continue;
        for (const actor of activity.actors) {
          total++;
          if (actor.roles.includes('hunter')) hunterMatches++;
        }
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(hunterMatches / total).toBeGreaterThan(0.5);
  });
});

describe('incidents', () => {
  it('keeps fatal incidents vanishingly rare', () => {
    let grave = 0;
    let cells = 0;
    for (let day = 1; day <= 365; day += 2) {
      for (let hour = 0; hour < 24; hour += 2) {
        cells++;
        grave += generate(day, hour, 'loc33').incidents.filter((i) => i.grave).length;
      }
    }
    // Source weights are per-day percentages well under 1%, spread over 24 hours.
    expect(grave / cells).toBeLessThan(0.005);
  });

  it('labels every incident the data can produce', () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 365; day++) {
      for (const hour of [7, 15]) {
        for (const incident of generate(day, hour, 'loc13').incidents) {
          seen.add(incident.key);
          expect(incident.label).not.toMatch(/[A-Z]/);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});

describe('every cell renders', () => {
  it('produces non-empty narration across a broad sample of the year', () => {
    for (let day = 1; day <= 365; day += 13) {
      for (let hour = 0; hour < 24; hour += 5) {
        for (const loc of Object.keys(locations)) {
          const scene = generateIfAny(day, hour, loc);
          if (!scene) continue;
          const html = narrateScene(scene, `${day}:${hour}:${loc}`);
          expect(html.length).toBeGreaterThan(20);
          expect(html).not.toContain('undefined');
          expect(html).not.toContain('NaN');
        }
      }
    }
  });
});
