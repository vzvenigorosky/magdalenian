/**
 * What the fallback ambience lines claim about who is present.
 *
 * The 23 lines in `default-events.json` split three ways: some assert the place
 * is empty, some assert people are at work there, and the rest are neutral
 * scene-setting. Both assertions can contradict the generated layer, in
 * opposite directions, so the engine and the narrator each need to know which
 * kind of line they are holding.
 *
 * Matched by pattern rather than whole string so the data stays editable, and
 * deliberately narrow — "quiet and still", "the air is still and tense" and
 * "the area is damp with dew" commit to nothing either way and are left alone.
 */

/** Lines claiming nobody is present. */
const ASSERTS_EMPTY: readonly RegExp[] = [
  /\bdeserted\b/i, // "The area is deserted, the only sound is the wind..."
  /\bno human activity\b/i, // "...There is no human activity here."
  /\bhome only to\b/i, // "...home only to nocturnal predators."
  /\bsilent, save for\b/i, // "The thickets and groves are silent, save for..."
  /\bonly evidence of\b/i, // "...the only evidence of the day's activity..."
];

/** Lines claiming people are here and busy. */
const ASSERTS_PEOPLE: readonly RegExp[] = [
  /\b(foragers|hunters|hunting party|artisans)\b/i,
  /\bthe band\b/i, // "Most of the band is asleep...", "The band gathers..."
  /\ba lone guard\b/i,
  /\bmain camp\b/i,
  /\bthe camp slowly stirs\b/i,
  /\bhub of activity\b/i,
  /\bpeople settle\b/i,
  /\bindividuals or small groups\b/i,
];

/** True when a line claims the place is empty of people. */
export function assertsEmpty(ambience: string): boolean {
  return ASSERTS_EMPTY.some((pattern) => pattern.test(ambience));
}

/** True when a line claims people are present and working. */
export function assertsPeoplePresent(ambience: string): boolean {
  return ASSERTS_PEOPLE.some((pattern) => pattern.test(ambience));
}
