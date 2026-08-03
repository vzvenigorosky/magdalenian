/**
 * Bends a location's flat activity weights toward the conditions of the hour.
 *
 * The source weights describe what a place is *for* — the Flint Quarry
 * weights knapping at 80 — but say nothing about darkness, rain or cold. A
 * quarry at 3am in a downpour should not read the same as a quarry at noon.
 */
import type { ActivityKey, HourlyWeather, Location } from '../types.ts';
import type { Rng } from './rng.ts';

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
 * Multiplies each weight by how plausible the activity is right now. Returns
 * a new object; zero-weight entries stay zero and are never resurrected.
 */
export function applyConditions(
  weights: Record<ActivityKey, number>,
  weather: HourlyWeather,
): Record<ActivityKey, number> {
  const isDark = weather.sunExposure === 'Dark';
  const isDim = weather.sunExposure === 'Low' || weather.sunExposure === 'Overcast';
  const isWet = weather.precip > 0;
  const isFreezing = weather.temp <= 0;

  const adjusted: Record<ActivityKey, number> = {};

  for (const [activity, base] of Object.entries(weights)) {
    if (base <= 0) {
      adjusted[activity] = 0;
      continue;
    }

    const traits = traitsOf(activity);
    let weight = base;

    if (traits.requiresDark) {
      // Stargazing is impossible by day and notable by night.
      weight = isDark ? weight * 8 : 0;
    } else if (isDark) {
      if (traits.outdoor) weight *= 0.05;
      if (traits.needsLight) weight *= 0.15;
      if (traits.restful) weight *= 6;
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
export function presenceChance(location: Location, weather: HourlyWeather): number {
  // The band lives at the cave mouth; someone is always there.
  if (location.type === 'CENTRAL_DWELLING') return 100;

  const { meters } = location.distanceFromCenter;
  let chance = meters <= 700 ? 65 : meters <= 1500 ? 50 : meters <= 3500 ? 35 : 25;

  if (weather.sunExposure === 'Dark') {
    // Shelters and trysting spots still see use after dark; open country does not.
    const sheltered = location.type === 'SECONDARY_CAVE' || location.type === 'INTIMATE_SPOT';
    chance *= sheltered ? 0.45 : 0.06;
  } else if (weather.sunExposure === 'Low' || weather.sunExposure === 'Overcast') {
    chance *= 0.8;
  }

  if (weather.precip > 3) chance *= 0.6;
  if (weather.temp <= -5) chance *= 0.7;

  return chance;
}

/** How many simultaneous activities a scene shows; 0 when nobody is there. */
export function activityCount(location: Location, weather: HourlyWeather, rng: Rng): number {
  if (!rng.chance(presenceChance(location, weather))) return 0;

  const isCentral = location.type === 'CENTRAL_DWELLING';
  if (weather.sunExposure === 'Dark') return isCentral ? 2 : 1;
  return isCentral ? 3 : 2;
}
