/** Tides, moonlight and the thirteen marked days. */
import { describe, expect, it } from 'vitest';
import {
  cosmicKind,
  cosmicPull,
  moonlight,
  parseClock,
  shoreAccess,
  tidalRange,
  tideStateAt,
} from '../src/sim/sky.ts';
import { isCoastal } from '../src/sim/weights.ts';
import type { DayIndexEntry } from '../src/types.ts';
import { locations, year } from './helpers.ts';

const asDay = (n: number) => year.find((d) => d.day === n) as unknown as DayIndexEntry;

describe('clock parsing', () => {
  it('reads the tide table format', () => {
    expect(parseClock('07:34')).toBeCloseTo(7.5667, 3);
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBeCloseTo(23.983, 2);
  });

  it('rejects nonsense rather than guessing', () => {
    for (const bad of ['', 'noon', '25:00', '7.34']) expect(parseClock(bad)).toBeNull();
  });

  it('rejects genuinely unparseable values', () => {
    for (const bad of ['24:30', '99:99', '1:2:3']) expect(parseClock(bad)).toBeNull();
  });
});

describe('tide state', () => {
  it('reports low water at the stated low tide', () => {
    const day = asDay(1); // low1 07:34, high2 13:44
    expect(tideStateAt(day.tides, 7)).toBe('low');
    expect(tideStateAt(day.tides, 14)).toBe('high');
  });

  it('passes through all four states over a day', () => {
    const day = asDay(1);
    const states = new Set(Array.from({ length: 24 }, (_, h) => tideStateAt(day.tides, h)));
    expect(states.size).toBeGreaterThan(2);
  });

  it('opens the shore at low water and closes it at high', () => {
    const day = asDay(1);
    const low = shoreAccess(day, 7);
    const high = shoreAccess(day, 14);
    expect(low).toBeGreaterThan(high * 3);
  });

  it('uncovers more shore at a spring tide than a neap one', () => {
    // Keyed off moon phase, not the unreliable tideAmplitude fields.
    const spring = year.find((d) => d.moonPhase === 'Full Moon')!;
    const neap = year.find((d) => d.moonPhase === 'First Quarter')!;
    const atOwnLow = (d: typeof spring) => {
      const day = d as unknown as DayIndexEntry;
      return shoreAccess(day, parseClock(day.tides.low1)!);
    };
    expect(atOwnLow(spring)).toBeGreaterThan(atOwnLow(neap));
  });

  it('puts spring tides at both syzygies and neaps at the quarters', () => {
    expect(tidalRange('New Moon')).toBe(1.5);
    expect(tidalRange('Full Moon')).toBe(1.5);
    expect(tidalRange('First Quarter')).toBe(0.5);
    expect(tidalRange('Last Quarter')).toBe(0.5);
    expect(tidalRange('Waxing Crescent')).toBe(1);
  });

  it('does not trust the tideAmplitude fields, which are inconsistent', () => {
    // Documents why tidalRange exists: the label carries no signal at all.
    const byName = new Map<string, number[]>();
    for (const day of year) {
      const list = byName.get(day.tideAmplitudeName as string) ?? [];
      list.push(day.tideAmplitudeValue as number);
      byName.set(day.tideAmplitudeName as string, list);
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const springMean = mean(byName.get('Spring')!);
    const neapMean = mean(byName.get('Neap')!);
    expect(Math.abs(springMean - neapMean)).toBeLessThan(0.2);
  });

  it('tolerates the eight malformed "HH:60" times in the source data', () => {
    // A minute-rollover bug in the tide table; "03:60" means 04:00.
    expect(parseClock('03:60')).toBe(4);
    expect(parseClock('23:60')).toBe(0);
    for (const day of year) {
      for (const value of Object.values(day.tides as Record<string, string>)) {
        expect(parseClock(value), `day ${day.day} ${value}`).not.toBeNull();
      }
    }
  });
});

describe('coastal detection', () => {
  it('finds exactly the two shore sites, by their weights not their names', () => {
    const coastal = Object.values(locations)
      .filter(isCoastal)
      .map((l) => l.name)
      .sort();
    expect(coastal).toEqual(['The Pebble Beach', 'The Sandy Cove']);
  });
});

describe('moonlight', () => {
  it('runs from dark new moon to full', () => {
    expect(moonlight('New Moon')).toBe(0);
    expect(moonlight('Full Moon')).toBe(1);
    expect(moonlight('First Quarter')).toBeLessThan(moonlight('Waxing Gibbous'));
  });

  it('is symmetric between waxing and waning', () => {
    expect(moonlight('Waxing Gibbous')).toBe(moonlight('Waning Gibbous'));
    expect(moonlight('First Quarter')).toBe(moonlight('Last Quarter'));
  });
});

describe('cosmic events', () => {
  it('classifies every event present in the year', () => {
    const kinds = new Map<string, string>();
    for (const day of year) kinds.set(day.cosmicEvent as string, cosmicKind(day.cosmicEvent as string));
    for (const [event, kind] of kinds) {
      if (event === 'None') expect(kind).toBe('none');
      else expect(kind, event).not.toBe('none');
    }
  });

  it('pulls people skyward for meteors and to rite for solstices', () => {
    expect(cosmicPull('meteors').sky).toBeGreaterThan(cosmicPull('meteors').rite);
    expect(cosmicPull('solstice').rite).toBeGreaterThan(cosmicPull('solstice').sky);
    expect(cosmicPull('none')).toEqual({ sky: 1, rite: 1 });
  });

  it('marks thirteen days of the year', () => {
    const marked = year.filter((d) => cosmicKind(d.cosmicEvent as string) !== 'none');
    expect(marked).toHaveLength(13);
  });
});
