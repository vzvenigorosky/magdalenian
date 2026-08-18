/**
 * Bends a location's flat activity weights toward the conditions of the hour.
 *
 * The source weights describe what a place is *for* — the Flint Quarry
 * weights knapping at 80 — but say nothing about darkness, rain or cold. A
 * quarry at 3am in a downpour should not read the same as a quarry at noon.
 */
import type { ActivityKey, AgeBand, DayIndexEntry, HourlyWeather, Location } from '../types.ts';
import type { Rng } from './rng.ts';
import {
  RITE,
  SKY_WATCHING,
  TIDE_BOUND,
  cosmicKind,
  cosmicPull,
  moonlight,
  shoreAccess,
} from './sky.ts';

export interface ActivityTraits {
  /** Happens in the open, so weather and darkness matter. */
  outdoor?: boolean;
  /** Only makes sense in darkness. */
  requiresDark?: boolean;
  /** Needs usable light — fine detail work, painting, sewing. */
  needsLight?: boolean;
  /** Physically demanding; children and elders are excluded. */
  strenuous?: boolean;
  /** Adults only. */
  adultOnly?: boolean;
  /** Rest and sleep, which darkness encourages. */
  restful?: boolean;
}

/** Prefix rules cover the bulk; the explicit table below overrides them. */
const PREFIX_TRAITS: ReadonlyArray<readonly [string, ActivityTraits]> = [
  ['hunting', { outdoor: true, strenuous: true, adultOnly: true }],
  ['trapping', { outdoor: true }],
  ['fishing', { outdoor: true }],
  ['foraging', { outdoor: true }],
  ['gathering', { outdoor: true }],
];

const EXPLICIT_TRAITS: Readonly<Record<ActivityKey, ActivityTraits>> = {
  exploring: { outdoor: true, strenuous: true, adultOnly: true },
  findingDryFirewood: { outdoor: true },
  maintainingLookout: { outdoor: true },
  washingBody: { outdoor: true },
  stargazing: { outdoor: true, requiresDark: true },
  cavePainting: { needsLight: true },
  makingPigments: { needsLight: true },
  sewingTailoredClothing: { needsLight: true },
  makingJewelryFromShells: { needsLight: true },
  carvingAntler: { needsLight: true },
  knappingFlint: { needsLight: true },
  preparingHides: { needsLight: true },
  weavingBaskets: { needsLight: true },
  butcheringAnimal: { needsLight: true, strenuous: true },
  craftingAtlatl: { needsLight: true },
  engravingWithBurin: { needsLight: true },
  // Both are heavy outdoor labour, and both already carry the seasonal signal
  // in their success chances: hide tents drop 44 -> 3 and storage pits 80 -> 10
  // in winter, when the ground is frozen.
  buildingHideTent: { outdoor: true, strenuous: true },
  diggingStoragePit: { outdoor: true, strenuous: true },
  smokingMeatOrFish: {},
  restingEffectively: { restful: true },
  meditatingOrTrance: { restful: true },
  sexualRelations: { adultOnly: true },
  masturbation: { adultOnly: true },
  privateArgument: { adultOnly: true },
  childcare: { adultOnly: true },
  teachingChild: { adultOnly: true },
  groupRitual: {},
  shamanicRitual: { adultOnly: true },
};

export function traitsOf(activity: ActivityKey): ActivityTraits {
  const explicit = EXPLICIT_TRAITS[activity];
  if (explicit) return explicit;
  for (const [prefix, traits] of PREFIX_TRAITS) {
    if (activity.startsWith(prefix)) return traits;
  }
  return {};
}

/**
 * How far each age will actually travel from camp, in their own walking
 * minutes. `childWalkMinutes` and `elderWalkMinutes` were sitting in the data
 * unused, and they sort the map cleanly: every location inside camp's orbit is
 * within 14 child-minutes, then there is a jump to 24 and beyond for the
 * ancestor stone, the hunting grounds and the peaks.
 *
 * Without this a toddler could be minded at a quarry, and an eighty-year-old
 * could turn up on a mountain five kilometres out.
 */
const TRAVEL_LIMITS: Readonly<Record<AgeBand, number>> = {
  infant: 15, // carried, and not taken far
  child: 15,
  adolescent: 55, // old enough for the nearer hunting grounds
  adult: Infinity,
  elder: 40,
};

/** Whether someone of this age plausibly walks out to this location. */
export function canReach(ageBand: AgeBand, location: Location): boolean {
  const { childWalkMinutes, elderWalkMinutes } = location.distanceFromCenter;
  const minutes = ageBand === 'elder' ? elderWalkMinutes : childWalkMinutes;
  return minutes <= TRAVEL_LIMITS[ageBand];
}

/**
 * A place is coastal if the data says shore work happens there, rather than if
 * its name happens to contain "beach" — the weights are the authority.
 */
export function isCoastal(location: Location): boolean {
  const { activities } = location.probabilities;
  return (activities.gatheringShellfish ?? 0) > 10 || (activities.huntingSeals ?? 0) > 10;
}

/**
 * Multiplies each weight by how plausible the activity is right now. Returns
 * a new object; zero-weight entries stay zero and are never resurrected.
 */
export function applyConditions(
  weights: Record<ActivityKey, number>,
  weather: HourlyWeather,
  day: DayIndexEntry,
  hour: number,
  location: Location,
): Record<ActivityKey, number> {
  const isDark = weather.sunExposure === 'Dark';
  const isDim = weather.sunExposure === 'Low' || weather.sunExposure === 'Overcast';
  const isWet = weather.precip > 0;
  const isFreezing = weather.temp <= 0;

  // A full moon is genuinely enough to work by; a new moon is not.
  const moon = isDark ? moonlight(day.moonPhase) : 0;
  const sky = cosmicPull(cosmicKind(day.cosmicEvent));
  const tide = isCoastal(location) ? shoreAccess(day, hour) : 1;

  const adjusted: Record<ActivityKey, number> = {};

  for (const [activity, base] of Object.entries(weights)) {
    if (base <= 0) {
      adjusted[activity] = 0;
      continue;
    }

    const traits = traitsOf(activity);
    let weight = base;

    if (traits.requiresDark) {
      // Stargazing is impossible by day and notable by night. A bright moon
      // washes out a meteor shower, so the darkest nights are the best ones.
      weight = isDark ? weight * 8 * (1.3 - moon * 0.6) : 0;
    } else if (isDark) {
      // Moonlight partially lifts the penalty on being out and on fine work.
      if (traits.outdoor) weight *= 0.05 + moon * 0.35;
      if (traits.needsLight) weight *= 0.15 + moon * 0.25;
      if (traits.restful) weight *= 6 - moon * 2;
    } else if (isDim) {
      if (traits.outdoor) weight *= 0.7;
      if (traits.needsLight) weight *= 0.6;
    }

    if (isWet && traits.outdoor) {
      // precip runs roughly 0-10 in the data; heavy rain nearly stops outdoor work.
      weight *= Math.max(0.1, 1 - Math.min(weather.precip, 10) / 12);
    }

    if (isFreezing) {
      if (traits.outdoor) weight *= 0.6;
      if (activity === 'washingBody') weight *= 0.05;
    }

    if (weather.temp >= 25 && traits.strenuous) weight *= 0.7;

    // Shellfish and seals depend on the water being out, not on the weather.
    if (TIDE_BOUND.test(activity)) weight *= tide;

    // The thirteen marked days of the year actually feel like something.
    if (SKY_WATCHING.test(activity)) weight *= sky.sky;
    if (RITE.test(activity)) weight *= sky.rite;

    adjusted[activity] = weight;
  }

  return adjusted;
}

/**
 * How likely anyone at all is at this location during this hour, 0-100.
 *
 * Without this every one of the 22 locations is staffed at all 24 hours, which
 * puts small children at a river bend at 2am and means the ambience lines that
 * describe a deserted place can never be true. Distance from camp does most of
 * the work: a valley three kilometres out is not somewhere the band idles.
 */
export function presenceChance(
  location: Location,
  weather: HourlyWeather,
  day: DayIndexEntry,
): number {
  // The band lives at the cave mouth; someone is always there.
  if (location.type === 'CENTRAL_DWELLING') return 100;

  const { meters } = location.distanceFromCenter;
  let chance = meters <= 700 ? 65 : meters <= 1500 ? 50 : meters <= 3500 ? 35 : 25;

  if (weather.sunExposure === 'Dark') {
    // Shelters and trysting spots still see use after dark; open country does not.
    const sheltered = location.type === 'SECONDARY_CAVE' || location.type === 'INTIMATE_SPOT';
    chance *= sheltered ? 0.45 : 0.06;
    // You can cross open country by a full moon. By a new moon you stay in.
    chance *= 1 + moonlight(day.moonPhase) * 1.6;
    // On the thirteen marked nights people go out to watch or to keep the rite.
    const kind = cosmicKind(day.cosmicEvent);
    if (kind !== 'none' && (location.type === 'RITUAL_SITE' || location.type === 'MOUNTAIN_AREA')) {
      chance *= 3.5;
    }
  } else if (weather.sunExposure === 'Low' || weather.sunExposure === 'Overcast') {
    chance *= 0.8;
  }

  if (weather.precip > 3) chance *= 0.6;
  if (weather.temp <= -5) chance *= 0.7;

  return chance;
}

/** How many simultaneous activities a scene shows; 0 when nobody is there. */
export function activityCount(
  location: Location,
  weather: HourlyWeather,
  day: DayIndexEntry,
  rng: Rng,
): number {
  if (!rng.chance(presenceChance(location, weather, day))) return 0;

  const isCentral = location.type === 'CENTRAL_DWELLING';
  if (weather.sunExposure === 'Dark') return isCentral ? 2 : 1;
  return isCentral ? 3 : 2;
}
