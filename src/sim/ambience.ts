/**
 * What the fallback ambience lines claim about who is present.
 *
 * Both claims can contradict the generated layer, in opposite directions, so
 * the engine and the narrator each need to know which kind of line they hold:
 * a line saying the place is deserted must not sit above four named people at
 * work, and a line saying the foragers are here must not sit above an empty
 * clearing.
 *
 * The claim is **declared in the authored source** (`data/ambience/ambience.json`)
 * rather than inferred from the prose. An earlier version pattern-matched the
 * text — workable for 23 lines, but a standing trap: any new phrasing silently
 * fell through as neutral. With 192 authored lines the writer states the intent
 * and the engine obeys it.
 *
 * The patterns survive only as a fallback for entries with no declaration.
 */
import type { DefaultEvent } from '../types.ts';

const ASSERTS_EMPTY_TEXT: readonly RegExp[] = [
  /\bdeserted\b/i,
  /\bno human activity\b/i,
  /\bhome only to\b/i,
  /\bsilent, save for\b/i,
  /\bonly evidence of\b/i,
];

const ASSERTS_PEOPLE_TEXT: readonly RegExp[] = [
  /\b(foragers|hunters|hunting party|artisans)\b/i,
  /\bthe band\b/i,
  /\ba lone guard\b/i,
  /\bmain camp\b/i,
  /\bthe camp slowly stirs\b/i,
  /\bhub of activity\b/i,
  /\bpeople settle\b/i,
  /\bindividuals or small groups\b/i,
];

/**
 * Ambience as the engine passes it around: the line itself plus what it
 * claims. Older callers may still hand over a bare string.
 */
export interface Ambience {
  text: string;
  presence: 'empty' | 'people' | 'neutral';
}

/** Normalises a data entry, or a bare string, into an `Ambience`. */
export function toAmbience(entry: DefaultEvent | string | undefined): Ambience {
  if (entry === undefined) {
    return { text: 'The world is quiet here. Nothing happens.', presence: 'neutral' };
  }
  if (typeof entry === 'string') return { text: entry, presence: inferPresence(entry) };
  return { text: entry.event, presence: entry.presence ?? inferPresence(entry.event) };
}

/** Last resort for undeclared lines. */
function inferPresence(text: string): 'empty' | 'people' | 'neutral' {
  if (ASSERTS_EMPTY_TEXT.some((p) => p.test(text))) return 'empty';
  if (ASSERTS_PEOPLE_TEXT.some((p) => p.test(text))) return 'people';
  return 'neutral';
}

/** True when a line claims the place is empty of people. */
export function assertsEmpty(ambience: Ambience | string): boolean {
  return (typeof ambience === 'string' ? inferPresence(ambience) : ambience.presence) === 'empty';
}

/** True when a line claims people are present and working. */
export function assertsPeoplePresent(ambience: Ambience | string): boolean {
  return (typeof ambience === 'string' ? inferPresence(ambience) : ambience.presence) === 'people';
}
