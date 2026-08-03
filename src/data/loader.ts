/**
 * Loads the generated datasets from `public/data/`.
 *
 * The day-level index (~126 KB, all 365 days) loads upfront because the time
 * navigator needs every day's season and moon phase to render. The heavy
 * per-day payloads — hourly weather and activity success chances, ~223 KB per
 * season — load only when a day in that season is first opened.
 */
import type {
  CharacterProfiles,
  CharactersData,
  DefaultEventsData,
  EventsData,
  LocationsData,
  ResolvedDay,
  Season,
  SeasonDetail,
  YearIndex,
} from '../types.ts';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function fetchJson<T>(file: string, whenMissing: string): Promise<T> {
  const response = await fetch(`${BASE}${file}`);
  if (!response.ok) throw new Error(whenMissing);
  return (await response.json()) as T;
}

export interface CoreData {
  yearIndex: YearIndex;
  locations: LocationsData;
  characters: CharactersData;
  profiles: CharacterProfiles;
  events: EventsData;
  defaultEvents: DefaultEventsData;
}

/** Error messages preserve the original page's voice (`magdalenian.html:86-90`). */
export async function loadCore(): Promise<CoreData> {
  const [yearIndex, locations, characters, profiles, events, defaultEvents] = await Promise.all([
    fetchJson<YearIndex>('year-index.json', 'The scrolls of seasons could not be found.'),
    fetchJson<LocationsData>('locations.json', 'The map of the land is lost to the mists.'),
    fetchJson<CharactersData>('characters.json', 'The faces of the people are hidden in shadow.'),
    fetchJson<CharacterProfiles>('character-profiles.json', 'The ages of the people are forgotten.'),
    fetchJson<EventsData>('events.json', 'The whispers of events are silent.'),
    fetchJson<DefaultEventsData>('default-events.json', 'The echoes of daily life are lost.'),
  ]);
  return { yearIndex, locations, characters, profiles, events, defaultEvents };
}

const seasonCache = new Map<Season, Promise<SeasonDetail>>();

/** Cached per season, so each chunk is fetched at most once per page load. */
export function loadSeasonDetail(season: Season): Promise<SeasonDetail> {
  let pending = seasonCache.get(season);
  if (!pending) {
    pending = fetchJson<SeasonDetail>(
      `year-detail-${season.toLowerCase()}.json`,
      `The days of ${season} are lost to the mists.`,
    ).catch((error: unknown) => {
      // Don't cache a rejected promise — a transient failure should be retryable.
      seasonCache.delete(season);
      throw error;
    });
    seasonCache.set(season, pending);
  }
  return pending;
}

/** Joins a day's index entry with its lazily-loaded detail. */
export async function resolveDay(yearIndex: YearIndex, day: number): Promise<ResolvedDay | null> {
  const entry = yearIndex.find((d) => d.day === day);
  if (!entry) return null;

  const detail = (await loadSeasonDetail(entry.season))[String(day)];
  if (!detail) return null;

  return { ...entry, hourly: detail.hourly, activitySuccessChance: detail.activitySuccessChance };
}
