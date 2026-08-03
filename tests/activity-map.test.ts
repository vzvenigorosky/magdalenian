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
      for (const variant of mapping.variants) {
        expect(successKeys.has(variant), `${activity} -> unknown success key ${variant}`).toBe(true);
      }
      if (mapping.nightVariant) {
        expect(successKeys.has(mapping.nightVariant)).toBe(true);
      }
    }
  });

  it('has no redundant mappings for keys that already match exactly', () => {
    for (const [activity, mapping] of Object.entries(ACTIVITY_SUCCESS_MAP)) {
      const isSelfOnly = mapping.variants.length === 1 && mapping.variants[0] === activity;
      expect(isSelfOnly, `${activity} maps only to itself and can be deleted`).toBe(false);
    }
  });

  it('accounts for every success key — mapped, exactly matched, or listed as unmapped', () => {
    const activityKeys = new Set(allActivityKeys());
    const mapped = new Set(
      Object.values(ACTIVITY_SUCCESS_MAP).flatMap((m) => [...m.variants, m.nightVariant ?? []].flat()),
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

  it('prefers deep sleep at night over daytime rest', () => {
    const night = resolveActivity('restingEffectively', summer.activitySuccessChance, {
      isNight: true,
    });
    const day = resolveActivity('restingEffectively', summer.activitySuccessChance);
    expect(night.successKey).toBe('deepSleep');
    expect(day.successKey).not.toBe('deepSleep');
  });

  it('picks the highest-scoring fish for the day', () => {
    const resolved = resolveActivity('fishingRiver', summer.activitySuccessChance);
    const { fishingRiverSalmon = 0, fishingRiverTrout = 0 } = summer.activitySuccessChance;
    expect(resolved.chance).toBe(Math.max(fishingRiverSalmon, fishingRiverTrout));
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
