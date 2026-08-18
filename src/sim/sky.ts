/**
 * The sky and the sea.
 *
 * Three fields sat in the day data doing nothing: the tide table (365 distinct
 * timetables, with Neap/Normal/Spring amplitudes), the moon phase, and the
 * cosmic events. All three governed real Magdalenian life — when you could
 * gather shellfish, whether you could see to move at night, and which nights
 * were worth staying awake for.
 */
import type { DayIndexEntry, MoonPhase, Tides } from '../types.ts';

/**
 * "07:34" -> 7.567 hours. Returns null for anything genuinely unparseable.
 *
 * Eight of the year's 1,460 tide times are written "HH:60" — day 80's high
 * water is "03:60" — which is a minute-rollover bug in whatever produced the
 * table. It plainly means the next hour, so it is rolled over here rather than
 * discarded, and rather than editing the source data.
 */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  let minutes = Number(match[2]);
  if (minutes === 60) {
    minutes = 0;
    hours += 1;
  }
  if (hours > 23 || minutes > 59) return hours === 24 && minutes === 0 ? 0 : null;
  return hours + minutes / 60;
}

/** Smallest gap between two times on a 24-hour clock, in hours. */
function hoursApart(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 24 - raw);
}

export type TideState = 'low' | 'falling' | 'rising' | 'high';

/**
 * Where the tide is at a given hour. Both lows and both highs are considered,
 * so the state follows the day's real semidiurnal rhythm rather than a guess.
 */
export function tideStateAt(tides: Tides, hour: number): TideState {
  const lows = [tides.low1, tides.low2].map(parseClock).filter((t): t is number => t !== null);
  const highs = [tides.high1, tides.high2].map(parseClock).filter((t): t is number => t !== null);
  if (lows.length === 0 || highs.length === 0) return 'rising';

  const toLow = Math.min(...lows.map((t) => hoursApart(hour, t)));
  const toHigh = Math.min(...highs.map((t) => hoursApart(hour, t)));

  if (toLow <= 1.5) return 'low';
  if (toHigh <= 1.5) return 'high';
  return toLow < toHigh ? 'falling' : 'rising';
}

/**
 * Tidal range from the moon phase, 0.5 (neap) to 1.5 (spring).
 *
 * Derived rather than read from the data, because both tide-amplitude fields
 * are unreliable. `tideAmplitudeName` is uncorrelated noise — Spring, Normal
 * and Neap days all average an amplitude near 1.0 across the full range. And
 * `tideAmplitudeValue` tracks lunar *illumination*, not tidal range: it peaks
 * at Full Moon (1.45) and bottoms at New Moon (0.55), whereas real spring
 * tides occur at both syzygies and neaps at the quarters.
 *
 * The moon phase itself is sound, and the true relationship is simple, so the
 * range is computed from it.
 */
export function tidalRange(phase: MoonPhase): number {
  switch (phase) {
    case 'New Moon':
    case 'Full Moon':
      return 1.5; // sun and moon aligned — spring tides
    case 'First Quarter':
    case 'Last Quarter':
      return 0.5; // pulling at right angles — neap tides
    default:
      return 1.0;
  }
}

/**
 * How good the shore is right now, as a multiplier.
 *
 * A low spring tide uncovers far more of the shore than a low neap tide, which
 * is exactly when a coastal band goes out for shellfish. At high water there is
 * nothing to collect.
 */
export function shoreAccess(day: DayIndexEntry, hour: number): number {
  const state = tideStateAt(day.tides, hour);
  const reach = 0.7 + tidalRange(day.moonPhase) * 0.5;
  switch (state) {
    case 'low':
      return 1.6 * reach;
    case 'falling':
      return 1.1 * reach;
    case 'rising':
      return 0.6;
    case 'high':
      return 0.2;
  }
}

/** Activities that depend on the water being out. */
export const TIDE_BOUND = /^(gatheringShellfish|huntingSeals)$/;

/**
 * Moonlight as a fraction of full, used to soften what darkness forbids.
 * A full moon on a clear night is genuinely enough to move and work by.
 */
export const MOONLIGHT: Readonly<Record<MoonPhase, number>> = {
  'New Moon': 0,
  'Waxing Crescent': 0.15,
  'First Quarter': 0.4,
  'Waxing Gibbous': 0.7,
  'Full Moon': 1,
  'Waning Gibbous': 0.7,
  'Last Quarter': 0.4,
  'Waning Crescent': 0.15,
};

export function moonlight(phase: MoonPhase): number {
  return MOONLIGHT[phase] ?? 0;
}

export type CosmicKind = 'none' | 'meteors' | 'solstice' | 'equinox' | 'conjunction' | 'comet';

/** Classifies the 13 cosmic events in the year into what they mean for the band. */
export function cosmicKind(cosmicEvent: string): CosmicKind {
  if (!cosmicEvent || cosmicEvent === 'None') return 'none';
  if (/meteor/i.test(cosmicEvent)) return 'meteors';
  if (/solstice/i.test(cosmicEvent)) return 'solstice';
  if (/equinox/i.test(cosmicEvent)) return 'equinox';
  if (/conjunction|alignment/i.test(cosmicEvent)) return 'conjunction';
  if (/comet/i.test(cosmicEvent)) return 'comet';
  return 'none';
}

/** How strongly a cosmic event pulls people to watch the sky, or to rite. */
export function cosmicPull(kind: CosmicKind): { sky: number; rite: number } {
  switch (kind) {
    case 'meteors':
      return { sky: 14, rite: 3 };
    case 'comet':
      return { sky: 16, rite: 8 };
    case 'conjunction':
      return { sky: 10, rite: 4 };
    case 'solstice':
      return { sky: 4, rite: 12 };
    case 'equinox':
      return { sky: 3, rite: 9 };
    case 'none':
      return { sky: 1, rite: 1 };
  }
}

/** Activities drawn to the night sky, and those that answer a turning point. */
export const SKY_WATCHING = /^(stargazing|meditatingOrTrance)$/;
export const RITE = /^(groupRitual|shamanicRitual|dancing|makingMusic|singingOrChanting)$/;
