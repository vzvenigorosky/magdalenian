/**
 * Puts the observer's position in the URL, so a scene can be bookmarked,
 * shared, or reached with the browser's back button.
 *
 * The format is deliberately readable: `#/d200/h13/loc22`.
 */
import type { Season } from '../types.ts';
import { SUB_SEASON_DEFINITIONS, selectedState, subSeasonForDay } from '../state.ts';

export interface Position {
  day: number;
  hour: number;
  locationId: string;
}

export function toHash(position: Position): string {
  return `#/d${position.day}/h${position.hour}/${position.locationId}`;
}

/** Parses a hash, returning null if it does not describe a valid position. */
export function parseHash(hash: string, isKnownLocation: (id: string) => boolean): Position | null {
  const match = /^#\/d(\d{1,3})\/h(\d{1,2})\/([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;

  const day = Number(match[1]);
  const hour = Number(match[2]);
  const locationId = match[3]!;

  if (!Number.isInteger(day) || day < 1 || day > 365) return null;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!isKnownLocation(locationId)) return null;

  return { day, hour, locationId };
}

/** Which season a day falls in, from the sub-season table. */
export function seasonForDay(day: number): Season {
  for (const [season, ranges] of Object.entries(SUB_SEASON_DEFINITIONS) as Array<
    [Season, Record<string, [number, number]>]
  >) {
    for (const [start, end] of Object.values(ranges)) {
      if (day >= start && day <= end) return season;
    }
  }
  return 'Summer';
}

/** Moves the app state to a position, keeping season and sub-season in step. */
export function applyPosition(position: Position): void {
  selectedState.day = position.day;
  selectedState.hour = position.hour;
  selectedState.locationId = position.locationId;
  selectedState.season = seasonForDay(position.day);
  selectedState.subSeason = subSeasonForDay(selectedState.season, position.day);
}

export function currentPosition(): Position {
  return {
    day: selectedState.day,
    hour: selectedState.hour,
    locationId: selectedState.locationId,
  };
}

/**
 * Writes the position to the URL. `replace` avoids stacking history entries
 * for the initial render.
 */
export function writeHash(position: Position, replace = false): void {
  const hash = toHash(position);
  if (window.location.hash === hash) return;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
}

/**
 * Listens for back/forward. Returns a teardown function.
 *
 * `popstate` covers the history buttons; `hashchange` covers a hash pasted or
 * edited directly in the address bar.
 */
export function onNavigate(handler: () => void): () => void {
  window.addEventListener('popstate', handler);
  window.addEventListener('hashchange', handler);
  return () => {
    window.removeEventListener('popstate', handler);
    window.removeEventListener('hashchange', handler);
  };
}
