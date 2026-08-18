/**
 * The authored ambience source and its expansion into the runtime shape.
 *
 * The previous data repeated 23 lines across all four seasons, so winter was
 * framed with summer text. These tests hold the replacement to its promises.
 */
import { describe, expect, it } from 'vitest';
import { PHASE_HOURS, SEASONS, expandAmbience, phaseForHour } from '../src/data/ambience-source.ts';
import { assertsEmpty, assertsPeoplePresent, toAmbience } from '../src/sim/ambience.ts';
import { ambienceSource, defaultEvents, locations } from './helpers.ts';

const LOCATION_TYPES = [...new Set(Object.values(locations).map((l) => l.type))].sort();
const PHASES = ['night', 'dawn', 'morning', 'midday', 'evening', 'settle'];

describe('phase model', () => {
  it('covers all 24 hours exactly once', () => {
    const hours = Object.values(PHASE_HOURS).flat().sort((a, b) => a - b);
    expect(hours).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('maps every hour to a phase', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(PHASES, `hour ${hour}`).toContain(phaseForHour(hour));
    }
  });
});

describe('authored source', () => {
  it('covers every location type, season and phase', () => {
    expect(Object.keys(ambienceSource).sort()).toEqual(LOCATION_TYPES);
    for (const type of Object.keys(ambienceSource)) {
      expect(Object.keys(ambienceSource[type]!).sort(), type).toEqual([...SEASONS].sort());
      for (const season of SEASONS) {
        expect(Object.keys(ambienceSource[type]![season]!).sort(), `${type}/${season}`).toEqual(
          [...PHASES].sort(),
        );
      }
    }
  });

  it('is 192 distinct lines — no season reuses another season’s text', () => {
    const lines: string[] = [];
    for (const type of Object.keys(ambienceSource)) {
      for (const season of SEASONS) {
        for (const phase of PHASES) {
          lines.push(ambienceSource[type]![season]![phase]!.text);
        }
      }
    }
    expect(lines).toHaveLength(192);
    expect(new Set(lines).size, 'duplicate ambience lines').toBe(192);
  });

  it('declares a presence for every line', () => {
    for (const type of Object.keys(ambienceSource)) {
      for (const season of SEASONS) {
        for (const phase of PHASES) {
          const entry = ambienceSource[type]![season]![phase]!;
          expect(['empty', 'people', 'neutral'], `${type}/${season}/${phase}`).toContain(
            entry.presence,
          );
          expect(entry.text.trim().length).toBeGreaterThan(20);
        }
      }
    }
  });

  it('never claims the home cave is empty — the band lives there', () => {
    for (const season of SEASONS) {
      for (const phase of PHASES) {
        const entry = ambienceSource.CENTRAL_DWELLING![season]![phase]!;
        expect(entry.presence, `${season}/${phase}`).toBe('people');
      }
    }
  });

  it('leaves the far country empty at night', () => {
    for (const type of ['HUNTING_GROUND', 'MOUNTAIN_AREA']) {
      for (const season of SEASONS) {
        expect(ambienceSource[type]![season]!.night!.presence, `${type}/${season}`).toBe('empty');
      }
    }
  });
});

describe('expansion to the runtime shape', () => {
  it('produces four seasons of 24 hours', () => {
    expect(Object.keys(defaultEvents).sort()).toEqual([...SEASONS].sort());
    for (const season of SEASONS) {
      expect(Object.keys(defaultEvents[season]!)).toHaveLength(24);
    }
  });

  it('gives every season, hour and location type a line', () => {
    let combinations = 0;
    for (const season of SEASONS) {
      for (let hour = 0; hour < 24; hour++) {
        const entries = defaultEvents[season]![String(hour)]!;
        for (const type of LOCATION_TYPES) {
          const found = entries.find((e) => e.location_type === type);
          expect(found, `${season} h${hour} ${type}`).toBeDefined();
          expect(found!.event.length).toBeGreaterThan(0);
          combinations++;
        }
      }
    }
    expect(combinations).toBe(4 * 24 * LOCATION_TYPES.length);
  });

  it('actually differs between seasons — the old file did not', () => {
    for (const type of LOCATION_TYPES) {
      const atNoon = SEASONS.map(
        (s) => defaultEvents[s]!['12']!.find((e) => e.location_type === type)!.event,
      );
      expect(new Set(atNoon).size, `${type} reads the same in every season`).toBe(4);
    }
  });

  it('carries the declared presence through to the runtime entries', () => {
    for (const season of SEASONS) {
      for (let hour = 0; hour < 24; hour++) {
        for (const entry of defaultEvents[season]![String(hour)]!) {
          const source =
            ambienceSource[entry.location_type]![season]![phaseForHour(hour)]!;
          expect(entry.presence).toBe(source.presence);
          expect(assertsEmpty(toAmbience(entry))).toBe(source.presence === 'empty');
          expect(assertsPeoplePresent(toAmbience(entry))).toBe(source.presence === 'people');
        }
      }
    }
  });

  it('throws rather than silently gapping if the source is incomplete', () => {
    const broken = JSON.parse(JSON.stringify(ambienceSource));
    delete broken.RITUAL_SITE.Winter.night;
    expect(() => expandAmbience(broken)).toThrow(/RITUAL_SITE\/Winter\/night/);
  });
});
