/** URL positions must round-trip, and refuse anything they cannot honour. */
import { describe, expect, it } from 'vitest';
import { parseHash, seasonForDay, toHash } from '../src/ui/router.ts';
import { SUB_SEASON_DEFINITIONS } from '../src/state.ts';
import { locations } from './helpers.ts';

const known = (id: string) => id in locations;

describe('hash round-trip', () => {
  it('survives a trip through the URL unchanged', () => {
    for (const position of [
      { day: 1, hour: 0, locationId: 'loc0' },
      { day: 200, hour: 13, locationId: 'loc22' },
      { day: 365, hour: 23, locationId: 'loc65' },
    ]) {
      expect(parseHash(toHash(position), known)).toEqual(position);
    }
  });

  it('round-trips every location id in the data', () => {
    for (const id of Object.keys(locations)) {
      const position = { day: 42, hour: 7, locationId: id };
      expect(parseHash(toHash(position), known), id).toEqual(position);
    }
  });

  it('reads as something a person could type', () => {
    expect(toHash({ day: 200, hour: 13, locationId: 'loc22' })).toBe('#/d200/h13/loc22');
  });
});

describe('rejecting bad positions', () => {
  it('refuses days outside the year', () => {
    for (const hash of ['#/d0/h0/loc0', '#/d366/h0/loc0', '#/d999/h0/loc0']) {
      expect(parseHash(hash, known), hash).toBeNull();
    }
  });

  it('refuses hours outside the day', () => {
    for (const hash of ['#/d1/h24/loc0', '#/d1/h99/loc0']) {
      expect(parseHash(hash, known), hash).toBeNull();
    }
  });

  it('refuses locations that do not exist', () => {
    // The ids are sparse — loc6 and loc8 are genuinely absent.
    for (const hash of ['#/d1/h0/loc6', '#/d1/h0/loc8', '#/d1/h0/nonsense']) {
      expect(parseHash(hash, known), hash).toBeNull();
    }
  });

  it('refuses malformed hashes rather than guessing', () => {
    for (const hash of ['', '#', '#/', '#/d1', '#/d1/h1', '#/x1/h1/loc0', '#/d1/h1/loc0/extra']) {
      expect(parseHash(hash, known), hash).toBeNull();
    }
  });
});

describe('season lookup', () => {
  it('agrees with the sub-season table for every day of the year', () => {
    for (const [season, ranges] of Object.entries(SUB_SEASON_DEFINITIONS)) {
      for (const [start, end] of Object.values(ranges)) {
        for (let day = start; day <= end; day++) {
          expect(seasonForDay(day), `day ${day}`).toBe(season);
        }
      }
    }
  });
});
