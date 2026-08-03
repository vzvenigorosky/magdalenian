import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CharacterProfiles,
  CharactersData,
  DefaultEventsData,
  EventsData,
  LocationsData,
} from '../src/types.ts';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');

/** Raw day record, before `build-data.ts` splits it. */
export interface RawDay {
  day: number;
  season: string;
  moonPhase: string;
  hourly: Array<{ hour: number; temp: number; precip: number; humidity: number; sunExposure: string }>;
  activitySuccessChance: Record<string, number>;
  [key: string]: unknown;
}

function read<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA, name), 'utf8')) as T;
}

export const year = read<RawDay[]>('magdalenian_year.json');
export const locations = read<LocationsData>('magdalenian_locations.json');
export const characters = read<CharactersData>('magdalenian_characters.json');
export const events = read<EventsData>('magdalenian_events.json');
export const defaultEvents = read<DefaultEventsData>('magdalenian_default_events.json');
export const profiles = read<CharacterProfiles>('character-profiles.json');

export const dayOf = (n: number): RawDay => {
  const found = year.find((d) => d.day === n);
  if (!found) throw new Error(`no day ${n}`);
  return found;
};

/** Every activity key weighted by any location. */
export const allActivityKeys = (): string[] => {
  const keys = new Set<string>();
  for (const location of Object.values(locations)) {
    for (const key of Object.keys(location.probabilities.activities)) keys.add(key);
  }
  return [...keys];
};
