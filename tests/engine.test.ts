import { describe, expect, it } from 'vitest';
import type { ResolvedDay } from '../src/types.ts';
import { assertsPeoplePresent } from '../src/sim/ambience.ts';
import {
  findAmbience,
  generateScene,
  minderCap,
  type ActivityOutcome,
  type GeneratedScene,
  type SceneInput,
} from '../src/sim/engine.ts';
import { narrateScene } from '../src/sim/narrate.ts';
import { canReach, traitsOf } from '../src/sim/weights.ts';
import { dayOf, defaultEvents, events, locations, profiles, relationships, year } from './helpers.ts';

const asDay = (n: number) => dayOf(n) as unknown as ResolvedDay;

function sceneInput(day: number, hour: number, locationId: string): SceneInput {
  const location = locations[locationId]!;
  const resolved = asDay(day);
  return {
    day: resolved,
    hour,
    location,
    profiles,
    relationships,
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
    expect(scene.ambience.text.length).toBeGreaterThan(0);
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

describe('who is allowed to be doing what', () => {
  /** Sweeps the grid coarsely enough to be fast but wide enough to be honest. */
  function sweep(visit: (scene: GeneratedScene, where: string) => void): void {
    for (let day = 1; day <= 365; day += 3) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const loc of Object.keys(locations)) {
          const scene = generateIfAny(day, hour, loc);
          if (scene) visit(scene, `day ${day} h${hour} ${loc}`);
        }
      }
    }
  }

  it('never gives an infant anything to do', () => {
    sweep((scene, where) => {
      for (const activity of scene.activities) {
        for (const actor of activity.actors) {
          expect(actor.ageBand, `${actor.name} ${activity.activity} at ${where}`).not.toBe('infant');
        }
      }
    });
  });

  it('never leaves a child without an adult or elder in the scene', () => {
    sweep((scene, where) => {
      const everyone = scene.activities.flatMap((a) => a.actors);
      const children = everyone.filter((p) => p.ageBand === 'child');
      if (children.length === 0) return;
      const grownUps = everyone.filter((p) => p.ageBand === 'adult' || p.ageBand === 'elder');
      expect(
        grownUps.length,
        `${children.map((c) => c.name).join(', ')} unsupervised at ${where}`,
      ).toBeGreaterThan(0);
    });
  });

  it('does not require a chaperone for adolescents', () => {
    let unchaperoned = 0;
    sweep((scene) => {
      const everyone = scene.activities.flatMap((a) => a.actors);
      if (everyone.length === 0) return;
      const onlyYoung =
        everyone.every((p) => p.ageBand === 'adolescent') && everyone.length > 0;
      if (onlyYoung) unchaperoned++;
    });
    expect(unchaperoned, 'adolescents should sometimes be out on their own').toBeGreaterThan(0);
  });

  it('never has one person doing two jobs at once', () => {
    sweep((scene, where) => {
      // Childminding is deliberately exempt: you watch the children *while*
      // you work, so a minder may appear once more elsewhere in the scene.
      const ids = scene.activities
        .filter((a) => a.activity !== 'childcare')
        .flatMap((a) => a.actors.map((p) => p.id));
      expect(new Set(ids).size, `someone double-booked at ${where}`).toBe(ids.length);
    });
  });

  it('only lets minders double up on light work, never on a hunt', () => {
    sweep((scene, where) => {
      const childcare = scene.activities.find((a) => a.activity === 'childcare');
      if (!childcare) return;
      const minders = new Set(childcare.actors.map((p) => p.id));
      for (const other of scene.activities) {
        if (other.activity === 'childcare') continue;
        const traits = traitsOf(other.activity);
        if (!traits.strenuous && !traits.outdoor) continue;
        for (const actor of other.actors) {
          expect(
            minders.has(actor.id),
            `${actor.name} minding children while ${other.activity} at ${where}`,
          ).toBe(false);
        }
      }
    });
  });

  it('never leaves an activity with nobody doing it', () => {
    sweep((scene, where) => {
      for (const activity of scene.activities) {
        expect(activity.actors.length, `${activity.activity} has no actors at ${where}`).toBeGreaterThan(0);
      }
    });
  });

  it('keeps minors out of grown-up business', () => {
    sweep((scene, where) => {
      for (const activity of scene.activities) {
        if (!traitsOf(activity.activity).adultOnly) continue;
        for (const actor of activity.actors) {
          expect(['adult', 'elder'], `${actor.name} ${activity.activity} at ${where}`).toContain(
            actor.ageBand,
          );
        }
      }
    });
  });
});

describe('nobody is somewhere they could not have walked to', () => {
  const far = ['loc22', 'loc45', 'loc29', 'loc7', 'loc65', 'loc33'];
  const near = ['loc0', 'loc25', 'loc14', 'loc13'];

  it('keeps children and infants out of the far country', () => {
    for (let day = 1; day <= 365; day += 2) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const loc of far) {
          const scene = generateIfAny(day, hour, loc);
          if (!scene) continue;
          const people = scene.activities.flatMap((a) => [...a.actors, ...(a.charges ?? [])]);
          for (const person of people) {
            expect(
              ['infant', 'child'],
              `${person.name} (${person.ageBand}) at ${loc} on day ${day}`,
            ).not.toContain(person.ageBand);
          }
        }
      }
    }
  });

  it('keeps elders off the distant peaks and hunting grounds', () => {
    for (let day = 1; day <= 365; day += 2) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const loc of ['loc45', 'loc29', 'loc7', 'loc22', 'loc65']) {
          const scene = generateIfAny(day, hour, loc);
          if (!scene) continue;
          for (const person of scene.activities.flatMap((a) => a.actors)) {
            expect(person.ageBand, `${person.name} at ${loc}`).not.toBe('elder');
          }
        }
      }
    }
  });

  it('still lets children be children close to camp', () => {
    let sightings = 0;
    for (let day = 1; day <= 365; day += 2) {
      for (let hour = 6; hour < 20; hour += 2) {
        for (const loc of near) {
          const scene = generateIfAny(day, hour, loc);
          if (!scene) continue;
          sightings += scene.activities
            .flatMap((a) => [...a.actors, ...(a.charges ?? [])])
            .filter((p) => p.ageBand === 'child' || p.ageBand === 'infant').length;
        }
      }
    }
    expect(sightings, 'children vanished from camp entirely').toBeGreaterThan(200);
  });

  it('lets adolescents reach the nearer hunting grounds but not the far ones', () => {
    expect(canReach('adolescent', locations.loc22!)).toBe(true); // 52 child-minutes
    expect(canReach('adolescent', locations.loc45!)).toBe(false); // 74
    expect(canReach('child', locations.loc10!)).toBe(true); // the quarry, 10
    expect(canReach('child', locations.loc5!)).toBe(false); // ancestor stone, 24
    expect(canReach('elder', locations.loc5!)).toBe(true); // 36 elder-minutes
    expect(canReach('elder', locations.loc33!)).toBe(false); // 49
    expect(canReach('adult', locations.loc29!)).toBe(true); // adults go anywhere
  });
});

describe('childminding is sized to the children', () => {
  const everyChildcareScene = (visit: (c: ActivityOutcome, where: string) => void): number => {
    let seen = 0;
    for (let day = 1; day <= 365; day += 2) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const loc of Object.keys(locations)) {
          const scene = generateIfAny(day, hour, loc);
          const childcare = scene?.activities.find((a) => a.activity === 'childcare');
          if (!childcare) continue;
          seen++;
          visit(childcare, `day ${day} h${hour} ${loc}`);
        }
      }
    }
    return seen;
  };

  it('never mixes more minders than the ratio allows', () => {
    const seen = everyChildcareScene((childcare, where) => {
      const charges = childcare.charges ?? [];
      expect(childcare.actors.length, `${where}: ${charges.length} children`).toBeLessThanOrEqual(
        minderCap(charges.length),
      );
    });
    expect(seen, 'no childminding anywhere in the sweep').toBeGreaterThan(100);
  });

  it('caps at two grown-ups for a small group', () => {
    everyChildcareScene((childcare, where) => {
      if ((childcare.charges ?? []).length > 4) return;
      expect(childcare.actors.length, where).toBeLessThanOrEqual(2);
    });
  });

  it('never minds nobody — there is always at least one child', () => {
    everyChildcareScene((childcare, where) => {
      expect((childcare.charges ?? []).length, where).toBeGreaterThan(0);
    });
  });

  it('always has at least one grown-up doing the minding', () => {
    everyChildcareScene((childcare, where) => {
      expect(childcare.actors.length, where).toBeGreaterThan(0);
      for (const minder of childcare.actors) {
        expect(['adult', 'elder'], `${minder.name} at ${where}`).toContain(minder.ageBand);
      }
    });
  });

  it('minds only children and infants, and never one of the minders', () => {
    everyChildcareScene((childcare, where) => {
      const minders = new Set(childcare.actors.map((p) => p.id));
      for (const charge of childcare.charges ?? []) {
        expect(['infant', 'child'], `${charge.name} at ${where}`).toContain(charge.ageBand);
        expect(minders.has(charge.id), `${charge.name} minds themself at ${where}`).toBe(false);
      }
    });
  });

  it('lets infants be minded even though they never act', () => {
    let infantCharges = 0;
    everyChildcareScene((childcare) => {
      infantCharges += (childcare.charges ?? []).filter((c) => c.ageBand === 'infant').length;
    });
    expect(infantCharges).toBeGreaterThan(0);
  });

  it('applies the stated ratio bands', () => {
    expect(minderCap(0)).toBe(0);
    expect(minderCap(1)).toBe(2);
    expect(minderCap(4)).toBe(2);
    expect(minderCap(5)).toBe(3);
    expect(minderCap(8)).toBe(3);
    expect(minderCap(9)).toBe(4);
    expect(minderCap(20)).toBe(4);
  });
});

describe('the band behaves like families', () => {
  const kin = (id: string, side: 'mates' | 'children' | 'grandchildren' | 'siblings') =>
    relationships[id]?.[side] ?? [];

  /** Walks the whole grid, gathering every instance of one activity. */
  function collect(activity: string): ActivityOutcome[] {
    const found: ActivityOutcome[] = [];
    for (let day = 1; day <= 365; day += 2) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const loc of Object.keys(locations)) {
          const match = generateIfAny(day, hour, loc)?.activities.filter(
            (a) => a.activity === activity,
          );
          if (match) found.push(...match);
        }
      }
    }
    return found;
  }

  it('pairs mates for intimacy rather than strangers', () => {
    const pairs = collect('sexualRelations').filter((a) => a.actors.length === 2);
    expect(pairs.length).toBeGreaterThan(50);
    const mated = pairs.filter((a) => kin(a.actors[0]!.id, 'mates').includes(a.actors[1]!.id));
    expect(mated.length / pairs.length).toBeGreaterThan(0.85);
  });

  it('never pairs anyone with a parent, child or sibling', () => {
    for (const pair of collect('sexualRelations')) {
      if (pair.actors.length < 2) continue;
      const [a, b] = pair.actors;
      expect(kin(a!.id, 'children'), `${a!.name} + ${b!.name}`).not.toContain(b!.id);
      expect(kin(a!.id, 'siblings'), `${a!.name} + ${b!.name}`).not.toContain(b!.id);
      expect(kin(b!.id, 'children'), `${a!.name} + ${b!.name}`).not.toContain(a!.id);
    }
  });

  it('has adults minding mostly their own children', () => {
    const scenes = collect('childcare');
    expect(scenes.length).toBeGreaterThan(100);
    let own = 0;
    let total = 0;
    for (const scene of scenes) {
      for (const minder of scene.actors) {
        total++;
        const mine = kin(minder.id, 'children').concat(kin(minder.id, 'grandchildren'));
        if ((scene.charges ?? []).some((c) => mine.includes(c.id))) own++;
      }
    }
    expect(own / total).toBeGreaterThan(0.5);
  });

  it('gives every teaching scene an actual pupil, taught by one grown-up', () => {
    const teaching = collect('teachingChild');
    expect(teaching.length).toBeGreaterThan(50);
    for (const scene of teaching) {
      expect(scene.actors).toHaveLength(1);
      expect(['adult', 'elder']).toContain(scene.actors[0]!.ageBand);
      expect((scene.charges ?? []).length).toBeGreaterThan(0);
      for (const pupil of scene.charges ?? []) {
        expect(['child', 'adolescent'], pupil.name).toContain(pupil.ageBand);
        expect(pupil.id).not.toBe(scene.actors[0]!.id);
      }
    }
  });

  it('has elders and parents teaching their own more often than not', () => {
    const teaching = collect('teachingChild');
    const own = teaching.filter((scene) => {
      const teacher = scene.actors[0]!;
      const mine = kin(teacher.id, 'children').concat(kin(teacher.id, 'grandchildren'));
      return (scene.charges ?? []).some((c) => mine.includes(c.id));
    });
    expect(own.length / teaching.length).toBeGreaterThan(0.35);
  });

  it('keeps kin influence out of activities where it makes no sense', () => {
    // Flint knapping should be picked on skill, not on who your brother is.
    const knapping = collect('knappingFlint').filter((a) => a.actors.length === 2);
    if (knapping.length < 30) return;
    const related = knapping.filter((a) => kin(a.actors[0]!.id, 'siblings').includes(a.actors[1]!.id));
    expect(related.length / knapping.length).toBeLessThan(0.35);
  });
});

describe('somewhere can simply be empty', () => {
  const scan = (loc: string, hours: number[]) => {
    let empty = 0;
    let total = 0;
    for (let day = 1; day <= 365; day += 2) {
      for (const hour of hours) {
        const scene = generateIfAny(day, hour, loc);
        if (!scene) continue;
        total++;
        if (scene.activities.length === 0) empty++;
      }
    }
    return { empty, total };
  };

  it('empties distant places in the dead of night', () => {
    const { empty, total } = scan('loc45', [1, 2, 3]); // The Open Steppe, 4.4 km out
    expect(empty / total).toBeGreaterThan(0.8);
  });

  it('still populates them by day', () => {
    const { empty, total } = scan('loc45', [11, 12, 13]);
    expect(empty / total).toBeLessThan(0.85);
  });

  it('never empties the cave the band lives in', () => {
    for (let day = 1; day <= 365; day += 5) {
      for (let hour = 0; hour < 24; hour++) {
        const scene = generateIfAny(day, hour, 'loc0');
        if (scene) expect(scene.activities.length, `day ${day} h${hour}`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves nobody for an incident to happen to when a place is empty', () => {
    for (let day = 1; day <= 365; day += 3) {
      for (let hour = 0; hour < 24; hour += 3) {
        for (const loc of Object.keys(locations)) {
          const scene = generateIfAny(day, hour, loc);
          if (scene && scene.activities.length === 0) expect(scene.incidents).toEqual([]);
        }
      }
    }
  });

  it('respects ambience that says the place is busy', () => {
    for (let day = 1; day <= 365; day += 3) {
      for (let hour = 0; hour < 24; hour += 2) {
        for (const loc of Object.keys(locations)) {
          const scene = generateIfAny(day, hour, loc);
          if (!scene || !assertsPeoplePresent(scene.ambience)) continue;
          expect(scene.activities.length, `day ${day} h${hour} ${loc}`).toBeGreaterThan(0);
        }
      }
    }
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
