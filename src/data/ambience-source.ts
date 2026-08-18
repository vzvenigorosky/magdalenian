/**
 * Expands the authored ambience source into the flat structure the app reads.
 *
 * `data/ambience/ambience.json` is written per location type, season and
 * day-phase — 8 x 4 x 6 = 192 lines. The runtime shape is season -> hour ->
 * one entry per location type, so the six phases are stretched across the 24
 * hours here.
 *
 * The old `magdalenian_default_events.json` had this same six-phase shape
 * hidden inside it, but with all four seasons identical, so winter scenes were
 * framed with summer text.
 */
import type { DefaultEventsData, LocationType, Season } from '../types.ts';

export type Phase = 'night' | 'dawn' | 'morning' | 'midday' | 'evening' | 'settle';

/** Which hours each phase covers. Night wraps around both ends of the day. */
export const PHASE_HOURS: Readonly<Record<Phase, readonly number[]>> = {
  night: [0, 1, 2, 3, 4, 22, 23],
  dawn: [5, 6, 7],
  morning: [8, 9, 10, 11],
  midday: [12, 13, 14, 15, 16],
  evening: [17, 18, 19],
  settle: [20, 21],
};

export const SEASONS: readonly Season[] = ['Summer', 'Autumn', 'Winter', 'Spring'];

/** What a line claims about who is present, declared rather than guessed. */
export type Presence = 'empty' | 'people' | 'neutral';

export interface AmbienceEntry {
  text: string;
  presence: Presence;
}

export type AmbienceSource = Record<string, Record<string, Record<string, AmbienceEntry>>>;

export function phaseForHour(hour: number): Phase {
  for (const [phase, hours] of Object.entries(PHASE_HOURS) as Array<[Phase, readonly number[]]>) {
    if (hours.includes(hour)) return phase;
  }
  return 'midday';
}

export function expandAmbience(source: AmbienceSource): DefaultEventsData {
  const out: DefaultEventsData = {};

  for (const season of SEASONS) {
    const hours: Record<string, Array<{ location_type: LocationType; event: string; presence: Presence }>> =
      {};

    for (let hour = 0; hour < 24; hour++) {
      const phase = phaseForHour(hour);
      const entries = [];

      for (const locationType of Object.keys(source)) {
        const entry = source[locationType]?.[season]?.[phase];
        if (!entry) throw new Error(`ambience missing for ${locationType}/${season}/${phase}`);
        entries.push({
          location_type: locationType as LocationType,
          event: entry.text,
          presence: entry.presence,
        });
      }
      hours[String(hour)] = entries;
    }
    out[season] = hours;
  }

  return out;
}
