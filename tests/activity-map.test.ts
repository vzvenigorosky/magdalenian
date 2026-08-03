import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_SUCCESS_MAP,
  UNMAPPED_SUCCESS_KEYS,
  humanizeActivity,
  resolveActivity,
} from '../src/data/activity-map.ts';
import { allActivityKeys, dayOf, locations, year } from './helpers.ts';

describe('activity map coverage', () => {
  const successKeys = new Set(Object.keys(dayOf(1).activitySuccessChance));

  it('resolves every location activity key to a chance', () => {
    for (const activity of allActivityKeys()) {
      const resolved = resolveActivity(activity, dayOf(1).activitySuccessChance);
      expect(resolved.chance, `${activity} produced a non-numeric chance`).toBeTypeOf('number');
      expect(resolved.chance).toBeGreaterThanOrEqual(0);
      expect(resolved.chance).toBeLessThanOrEqual(100);
    }
  });

  it('only maps variants that exist in the success data', () => {
    for (const [activity, mapping] of Object.entries(ACTIVITY_SUCCESS_MAP)) {
      for (const variant of [...mapping.variants, mapping.nightVariant, mapping.dimVariant]) {
        if (variant === undefined) continue;
        expect(successKeys.has(variant), `${activity} -> unknown success key ${variant}`).toBe(true);
      }
    }
  });

  it('has no redundant mappings for keys that already match exactly', () => {
    for (const [activity, mapping] of Object.entries(ACTIVITY_SUCCESS_MAP)) {
      const isSelfOnly = mapping.variants.length === 1 && mapping.variants[0] === activity;
      const hasTimeVariant = Boolean(mapping.nightVariant ?? mapping.dimVariant);
      expect(
        isSelfOnly && !hasTimeVariant,
        `${activity} maps only to itself and can be deleted`,
      ).toBe(false);
    }
  });

  /**
   * The real coverage question is not whether a key is *mentioned* but whether
   * any location and day can actually produce it. A variant can be mapped and
   * still be dead: `napping` scores 75 against `restingEffectively`'s 80 every
   * day, so under a pure highest-score rule it was never once selected.
   */
  it('can actually select every success key at some location, day and light level', () => {
    const selectable = new Set<string>();
    for (const location of Object.values(locations)) {
      for (const [activity, weight] of Object.entries(location.probabilities.activities)) {
        if (weight > 0) selectable.add(activity);
      }
    }

    const reachable = new Set<string>();
    for (const day of year) {
      for (const activity of selectable) {
        for (const options of [{}, { isNight: true }, { isDim: true }]) {
          const { successKey } = resolveActivity(activity, day.activitySuccessChance, options);
          if (successKey) reachable.add(successKey);
        }
      }
    }

    const unreachable = [...successKeys].filter(
      (key) => !reachable.has(key) && !UNMAPPED_SUCCESS_KEYS.includes(key),
    );
    expect(unreachable, 'success keys that nothing can ever select').toEqual([]);
  });

  it('gives every location activity somewhere it can actually be drawn', () => {
    const anywhere = new Set<string>();
    for (const location of Object.values(locations)) {
      for (const [activity, weight] of Object.entries(location.probabilities.activities)) {
        if (weight > 0) anywhere.add(activity);
      }
    }
    const dead = allActivityKeys().filter((activity) => !anywhere.has(activity));
    expect(dead, 'activities weighted zero at every single location').toEqual([]);
  });

  it('accounts for every success key — mapped, exactly matched, or listed as unmapped', () => {
    const activityKeys = new Set(allActivityKeys());
    const mapped = new Set(
      Object.values(ACTIVITY_SUCCESS_MAP).flatMap((m) =>
        [...m.variants, m.nightVariant ?? [], m.dimVariant ?? []].flat(),
      ),
    );
    const unaccounted = [...successKeys].filter(
      (key) => !mapped.has(key) && !activityKeys.has(key) && !UNMAPPED_SUCCESS_KEYS.includes(key),
    );
    expect(unaccounted, 'new success keys appeared in the data and need a decision').toEqual([]);
  });

  it('keeps UNMAPPED_SUCCESS_KEYS honest — each is genuinely unreachable', () => {
    const activityKeys = new Set(allActivityKeys());
    const mapped = new Set(Object.values(ACTIVITY_SUCCESS_MAP).flatMap((m) => m.variants));
    for (const key of UNMAPPED_SUCCESS_KEYS) {
      expect(activityKeys.has(key) || mapped.has(key), `${key} is reachable and should be removed`).toBe(
        false,
      );
    }
  });

  it('has nothing left stranded — the unmapped list is empty', () => {
    expect(UNMAPPED_SUCCESS_KEYS).toEqual([]);
  });
});

describe('seasonal variant selection', () => {
  const summer = year.find((d) => d.season === 'Summer')!;
  const autumn = year.find((d) => d.season === 'Autumn')!;
  const winter = year.find((d) => d.season === 'Winter')!;

  it('picks hazelnuts only once autumn makes them viable', () => {
    // foragingHazelnuts is 0 in summer, 70 in autumn.
    expect(summer.activitySuccessChance.foragingHazelnuts).toBe(0);
    expect(resolveActivity('foragingNuts', summer.activitySuccessChance).chance).toBe(0);
    expect(resolveActivity('foragingNuts', autumn.activitySuccessChance).chance).toBeGreaterThan(0);
  });

  it('swaps red deer for reindeer when winter favours them', () => {
    const winterHunt = resolveActivity('huntingRedDeer', winter.activitySuccessChance);
    expect(winterHunt.successKey).toBe('huntingReindeer');
    expect(winterHunt.chance).toBeGreaterThan(winter.activitySuccessChance.huntingRedDeer!);
  });

  it('splits rest by light level: deep sleep at night, a nap in dim light', () => {
    const chances = summer.activitySuccessChance;
    expect(resolveActivity('restingEffectively', chances, { isNight: true }).successKey).toBe(
      'deepSleep',
    );
    expect(resolveActivity('restingEffectively', chances, { isDim: true }).successKey).toBe('napping');
    expect(resolveActivity('restingEffectively', chances).successKey).toBe('restingEffectively');
  });

  it('lets darkness win over dimness if both are somehow set', () => {
    const resolved = resolveActivity('restingEffectively', summer.activitySuccessChance, {
      isNight: true,
      isDim: true,
    });
    expect(resolved.successKey).toBe('deepSleep');
  });

  it('picks the highest-scoring fish for the day', () => {
    const resolved = resolveActivity('fishingRiver', summer.activitySuccessChance);
    const { fishingRiverSalmon = 0, fishingRiverTrout = 0 } = summer.activitySuccessChance;
    expect(resolved.chance).toBe(Math.max(fishingRiverSalmon, fishingRiverTrout));
  });
});

describe('newly weighted activities', () => {
  const weightsFor = (activity: string) =>
    Object.entries(locations)
      .map(([id, l]) => [id, l.probabilities.activities[activity] ?? 0] as const)
      .filter(([, w]) => w > 0);

  it('confines seal hunting to the two coastal sites', () => {
    const named = weightsFor('huntingSeals').map(([id]) => locations[id]!.name);
    expect(named.sort()).toEqual(['The Pebble Beach', 'The Sandy Cove']);
  });

  it('puts storage pits and spear-thrower work at the home cave above all', () => {
    for (const activity of ['diggingStoragePit', 'craftingAtlatl']) {
      const ranked = weightsFor(activity).sort((a, b) => b[1] - a[1]);
      expect(ranked[0]?.[0], activity).toBe('loc0');
    }
  });

  it('puts engraving highest in the Painted Cave', () => {
    const ranked = weightsFor('engravingWithBurin').sort((a, b) => b[1] - a[1]);
    expect(ranked[0]?.[0]).toBe('loc16');
  });

  it('keeps hide tents away from the home cave and out on the long trips', () => {
    const byId = Object.fromEntries(weightsFor('buildingHideTent'));
    // Distant hunting grounds and mountains outrank the cave they already live in.
    for (const far of ['loc22', 'loc45', 'loc7', 'loc29']) {
      expect(byId[far], far).toBeGreaterThan(byId.loc0!);
    }
  });

  it('carries the winter collapse in frozen-ground work', () => {
    const winter = year.find((d) => d.season === 'Winter')!;
    const summerDay = year.find((d) => d.season === 'Summer')!;
    for (const activity of ['diggingStoragePit', 'buildingHideTent']) {
      const cold = resolveActivity(activity, winter.activitySuccessChance).chance;
      const warm = resolveActivity(activity, summerDay.activitySuccessChance).chance;
      expect(cold, activity).toBeLessThan(warm);
    }
  });

  it('gives each a readable label rather than a raw key', () => {
    for (const activity of [
      'huntingSeals',
      'buildingHideTent',
      'diggingStoragePit',
      'craftingAtlatl',
      'engravingWithBurin',
    ]) {
      const label = humanizeActivity(activity);
      expect(label).not.toMatch(/[A-Z]/);
      expect(label).toContain(' ');
    }
  });
});

describe('unmapped social activities', () => {
  it('always succeed, since they are not attempts that can fail', () => {
    for (const activity of ['gossiping', 'delousing', 'stargazing', 'butcheringAnimal']) {
      const resolved = resolveActivity(activity, dayOf(1).activitySuccessChance);
      expect(resolved.successKey).toBeNull();
      expect(resolved.chance).toBe(100);
    }
  });
});

describe('humanizeActivity', () => {
  it('gives every location activity a readable, lower-case label', () => {
    for (const activity of allActivityKeys()) {
      const label = humanizeActivity(activity);
      expect(label).not.toMatch(/[A-Z]/);
      expect(label.length).toBeGreaterThan(2);
    }
  });

  it('falls back to splitting camelCase for unknown keys', () => {
    expect(humanizeActivity('someNewActivity')).toBe('some new activity');
  });

  it('covers the location-specific bonus activities', () => {
    expect(locations.loc16!.probabilities.activities.shamanicRitual).toBeDefined();
    expect(locations.loc65!.probabilities.activities.huntingWildBoar).toBeDefined();
    expect(humanizeActivity('shamanicRitual')).toBe('working a shamanic rite');
    expect(humanizeActivity('huntingWildBoar')).toBe('hunting wild boar');
  });
});
