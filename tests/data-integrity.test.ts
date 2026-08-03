/**
 * Guards the datasets themselves. These catch the kind of breakage that no
 * amount of application code can survive — a scheduled event pointing at a
 * location that does not exist, a speaker with no character record, a gap in
 * the fallback matrix that would leave a cell blank.
 */
import { describe, expect, it } from 'vitest';
import { SUB_SEASON_DEFINITIONS } from '../src/state.ts';
import type { Season } from '../src/types.ts';
import { characters, defaultEvents, events, locations, profiles, year } from './helpers.ts';

describe('year data', () => {
  it('covers all 365 days exactly once', () => {
    const days = year.map((d) => d.day).sort((a, b) => a - b);
    expect(days).toEqual(Array.from({ length: 365 }, (_, i) => i + 1));
  });

  it('gives every day 24 distinct hours', () => {
    for (const day of year) {
      expect(day.hourly).toHaveLength(24);
      expect(new Set(day.hourly.map((h) => h.hour)).size).toBe(24);
    }
  });

  it('uses one stable success-chance schema across the whole year', () => {
    const schemas = new Set(year.map((d) => Object.keys(d.activitySuccessChance).sort().join(',')));
    expect(schemas.size).toBe(1);
  });

  it('keeps success chances within 0-100', () => {
    for (const day of year) {
      for (const [key, value] of Object.entries(day.activitySuccessChance)) {
        expect(value, `day ${day.day} ${key}`).toBeGreaterThanOrEqual(0);
        expect(value, `day ${day.day} ${key}`).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('sub-season ranges', () => {
  it('agree with each day’s own season field', () => {
    for (const [season, ranges] of Object.entries(SUB_SEASON_DEFINITIONS) as Array<
      [Season, Record<string, [number, number]>]
    >) {
      for (const [start, end] of Object.values(ranges)) {
        for (let day = start; day <= end; day++) {
          expect(year.find((d) => d.day === day)!.season, `day ${day}`).toBe(season);
        }
      }
    }
  });

  it('tile the year with no gaps or overlaps', () => {
    const covered = Object.values(SUB_SEASON_DEFINITIONS)
      .flatMap((ranges) => Object.values(ranges))
      .flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, i) => start + i))
      .sort((a, b) => a - b);
    expect(covered).toEqual(Array.from({ length: 365 }, (_, i) => i + 1));
  });
});

describe('authored events', () => {
  it('reference locations that exist', () => {
    for (const event of events.schedule) {
      expect(locations[event.location], `event at day ${event.day} -> ${event.location}`).toBeDefined();
    }
  });

  it('reference speakers that exist', () => {
    for (const event of events.schedule) {
      if (event.type !== 'dialogue') continue;
      for (const line of event.content.dialogue) {
        expect(characters[line.speakerId], `speaker ${line.speakerId}`).toBeDefined();
      }
    }
  });

  it('sit within valid days and hours', () => {
    for (const event of events.schedule) {
      expect(event.day).toBeGreaterThanOrEqual(1);
      expect(event.day).toBeLessThanOrEqual(365);
      expect(event.hour).toBeGreaterThanOrEqual(0);
      expect(event.hour).toBeLessThan(24);
    }
  });

  it('has at most one event per day/hour/location cell', () => {
    const keys = events.schedule.map((e) => `${e.day}:${e.hour}:${e.location}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('fallback ambience', () => {
  it('covers every season, hour and location type', () => {
    const locationTypes = new Set(Object.values(locations).map((l) => l.type));
    let combinations = 0;

    for (const season of ['Summer', 'Autumn', 'Winter', 'Spring']) {
      for (let hour = 0; hour < 24; hour++) {
        const entries = defaultEvents[season]?.[String(hour)];
        expect(entries, `${season} hour ${hour}`).toBeDefined();
        for (const type of locationTypes) {
          const found = entries!.find((e) => e.location_type === type);
          expect(found, `${season} hour ${hour} ${type}`).toBeDefined();
          expect(found!.event.length).toBeGreaterThan(0);
          combinations++;
        }
      }
    }
    expect(combinations).toBe(4 * 24 * locationTypes.size);
  });
});

describe('character profiles', () => {
  it('cover every character exactly', () => {
    expect(Object.keys(profiles).sort()).toEqual(Object.keys(characters).sort());
  });

  it('carry a valid age band and auditable evidence', () => {
    for (const profile of Object.values(profiles)) {
      expect(['infant', 'child', 'adolescent', 'adult', 'elder']).toContain(profile.ageBand);
      expect(profile.evidence.length).toBeGreaterThan(0);
    }
  });

  it('agree with any age the description states outright', () => {
    for (const [id, profile] of Object.entries(profiles)) {
      const stated = characters[id]!.description0?.match(/\b(\w+)\s+winters\b/i);
      if (!stated) continue;
      expect(profile.age, characters[id]!.description0).toBeTypeOf('number');
      const band =
        profile.age! < 2 ? 'infant' : profile.age! < 10 ? 'child' : profile.age! < 16 ? 'adolescent' : 'adult';
      expect(profile.ageBand, characters[id]!.description0).toBe(band);
    }
  });

  it('leave someone able to supervise and someone able to do heavy work', () => {
    const bands = Object.values(profiles).map((p) => p.ageBand);
    expect(bands.filter((b) => b === 'adult' || b === 'elder').length).toBeGreaterThan(10);
    expect(bands.filter((b) => b === 'infant').length).toBeGreaterThan(0);
    expect(bands.filter((b) => b === 'child').length).toBeGreaterThan(0);
  });

  it('leave enough adults to staff strenuous work', () => {
    const adults = Object.values(profiles).filter((p) => p.ageBand === 'adult');
    expect(adults.length).toBeGreaterThan(10);
  });

  it('agree with each character’s primary description', () => {
    // description0 is the age descriptor the heuristic reads; re-derive here so
    // hand-edits to character-profiles.json cannot silently contradict it.
    for (const [id, profile] of Object.entries(profiles)) {
      const primary = characters[id]!.description0 ?? '';
      // A stated age ("a boy of twelve winters") outranks any keyword.
      if (/\b\w+\s+winters\b/i.test(primary)) continue;
      if (/\bold\b/i.test(primary)) expect(profile.ageBand, primary).toBe('elder');
      else if (/\b(man|woman)\b/i.test(primary)) expect(profile.ageBand, primary).toBe('adult');
      else if (/\b(infant|newborn)\b/i.test(primary)) expect(profile.ageBand, primary).toBe('infant');
      else if (/\badolescent\b/i.test(primary)) expect(profile.ageBand, primary).toBe('adolescent');
      else if (/\b(girl|boy|child)\b/i.test(primary)) expect(profile.ageBand, primary).toBe('child');
    }
  });
});

describe('locations', () => {
  it('have non-negative activity and incident weights', () => {
    for (const [id, location] of Object.entries(locations)) {
      for (const [key, weight] of Object.entries(location.probabilities.activities)) {
        expect(weight, `${id} ${key}`).toBeGreaterThanOrEqual(0);
      }
      for (const [key, weight] of Object.entries(location.probabilities.events)) {
        expect(weight, `${id} ${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('have at least one viable activity each', () => {
    for (const [id, location] of Object.entries(locations)) {
      const viable = Object.values(location.probabilities.activities).filter((w) => w > 0);
      expect(viable.length, id).toBeGreaterThan(0);
    }
  });

  it('declare an id matching their key', () => {
    for (const [id, location] of Object.entries(locations)) {
      expect(location.id).toBe(id);
    }
  });
});
