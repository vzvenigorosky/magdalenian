import type { Season } from './types.ts';

/** Day ranges per sub-season, carried over from `magdalenian.html:68-73`. */
export const SUB_SEASON_DEFINITIONS: Record<Season, Record<string, [number, number]>> = {
  Summer: { 'Early Summer': [1, 30], Midsummer: [31, 61], 'Late Summer': [62, 91] },
  Autumn: { 'Early Autumn': [92, 122], 'Mid-Autumn': [123, 153], 'Late Autumn': [154, 183] },
  Winter: { 'Early Winter': [184, 214], Midwinter: [215, 244], 'Late Winter': [245, 274] },
  Spring: { 'Early Spring': [275, 305], 'Mid-Spring': [306, 335], 'Late Spring': [336, 365] },
};

export interface SelectedState {
  season: Season;
  subSeason: string;
  day: number;
  hour: number;
  locationId: string;
}

/** Same opening view as the original page (`magdalenian.html:110`). */
export const selectedState: SelectedState = {
  season: 'Summer',
  subSeason: 'Early Summer',
  day: 1,
  hour: 9,
  locationId: 'loc0',
};

export function subSeasonsOf(season: Season): Record<string, [number, number]> {
  return SUB_SEASON_DEFINITIONS[season];
}

/** Which sub-season contains a given day, used when the day changes seasons. */
export function subSeasonForDay(season: Season, day: number): string {
  const ranges = Object.entries(subSeasonsOf(season));
  const found = ranges.find(([, [start, end]]) => day >= start && day <= end);
  return found ? found[0] : (ranges[0]?.[0] ?? '');
}
