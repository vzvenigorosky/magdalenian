/**
 * Turns a (day, hour, location) coordinate into a scene.
 *
 * Resolution order is strict:
 *   1. An authored event for that exact cell wins outright.
 *   2. Otherwise the scene is generated from the location's activity weights,
 *      the day's success chances, and the hour's weather.
 *   3. The season/hour/location-type line from `default-events.json` always
 *      provides the ambient framing underneath.
 *
 * Generation is seeded from the coordinate, so a cell always yields the same
 * scene no matter how many times it is revisited.
 */
import type {
  AuthoredEvent,
  CharacterProfile,
  CharacterProfiles,
  IncidentKey,
  Location,
  ResolvedDay,
} from '../types.ts';
import { resolveActivity, humanizeActivity } from '../data/activity-map.ts';
import { createRng, hashSeed, weightedSample, type Rng } from './rng.ts';
import { activityCount, applyConditions, traitsOf } from './weights.ts';

export interface ActivityOutcome {
  activity: string;
  /** The specific success key chosen, e.g. `huntingReindeer`. */
  successKey: string | null;
  label: string;
  chance: number;
  succeeded: boolean;
  actors: CharacterProfile[];
}

export interface Incident {
  key: IncidentKey;
  label: string;
  /** True for the rare, severe entries — used to set narration tone. */
  grave: boolean;
}

export interface GeneratedScene {
  kind: 'generated';
  ambience: string;
  activities: ActivityOutcome[];
  incidents: Incident[];
}

export interface AuthoredScene {
  kind: 'authored';
  ambience: string;
  event: AuthoredEvent;
}

export type Scene = AuthoredScene | GeneratedScene;

export interface SceneInput {
  day: ResolvedDay;
  hour: number;
  location: Location;
  profiles: CharacterProfiles;
  authored: AuthoredEvent[];
  ambience: string;
}

/** Incidents that end or change a life, narrated with weight rather than as colour. */
const GRAVE_INCIDENTS = new Set<IncidentKey>([
  'fatalFall',
  'drowning',
  'fatalHuntingAccident',
  'suddenIllness',
  'childbirthComplication',
]);

const INCIDENT_LABELS: Readonly<Record<string, string>> = {
  minorInjury: 'a minor injury',
  toolBreakage: 'a broken tool',
  rareResourceFind: 'an unexpected find',
  predatorSighting: 'a predator sighted nearby',
  unexpectedWeatherChange: 'a sudden turn in the weather',
  foodSpoilage: 'food gone bad',
  disputeOverResources: 'a dispute over what was gathered',
  findingStrangeFossil: 'a strange stone, shaped like a creature',
  sightingOfRareBird: 'an unfamiliar bird',
  minorIllness: 'a touch of sickness',
  discoveryOfNewPath: 'a new way through',
  fatalFall: 'a fatal fall',
  drowning: 'a drowning',
  fatalHuntingAccident: 'a fatal accident in the hunt',
  suddenIllness: 'a sudden, severe illness',
  childbirthComplication: 'a difficult birth',
};

/** Role hints that make a character a natural fit for an activity. */
const ROLE_AFFINITY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^hunting/, 'hunter'],
  [/^trapping/, 'hunter'],
  [/^fishing/, 'fisher'],
  [/^(foraging|gathering)/, 'forager'],
  [/^(knapping|carving|sewing|weaving|preparing|making)/, 'crafter'],
  [/(Ritual|meditating)/, 'shaman'],
  [/^(cavePainting|makingPigments)/, 'artist'],
  [/^tellingStories/, 'storyteller'],
  [/^maintainingLookout/, 'lookout'],
];

export function findAuthored(
  schedule: AuthoredEvent[],
  day: number,
  hour: number,
  locationId: string,
): AuthoredEvent | undefined {
  return schedule.find((e) => e.day === day && e.hour === hour && e.location === locationId);
}

/** Season/hour/location-type fallback line, used as scene-setting for every scene. */
export function findAmbience(
  defaultEvents: Record<string, Record<string, Array<{ location_type: string; event: string }>>>,
  season: string,
  hour: number,
  locationType: string,
): string {
  const entry = defaultEvents[season]?.[String(hour)]?.find((e) => e.location_type === locationType);
  return entry?.event ?? 'The world is quiet here. Nothing happens.';
}

function eligibleActors(
  profiles: CharacterProfiles,
  activity: string,
): CharacterProfile[] {
  const traits = traitsOf(activity);
  return Object.values(profiles).filter((profile) => {
    if (traits.strenuous && profile.ageBand !== 'adult') return false;
    if (traits.adultOnly && profile.ageBand !== 'adult') return false;
    return true;
  });
}

function chooseActors(
  profiles: CharacterProfiles,
  activity: string,
  rng: Rng,
): CharacterProfile[] {
  const pool = eligibleActors(profiles, activity);
  if (pool.length === 0) return [];

  const affinity = ROLE_AFFINITY.find(([pattern]) => pattern.test(activity))?.[1];

  // Characters whose derived roles suit the activity are far likelier to appear,
  // so the band reads as having specialists rather than interchangeable bodies.
  const weights: Record<string, number> = {};
  for (const profile of pool) {
    weights[profile.id] = affinity && profile.roles.includes(affinity) ? 8 : 1;
  }

  const wanted = activity === 'childcare' || activity === 'groupRitual' ? rng.int(2, 3) : rng.int(1, 2);
  const ids = weightedSample(weights, Math.min(wanted, pool.length), rng);
  return ids.map((id) => profiles[id]).filter((p): p is CharacterProfile => p !== undefined);
}

function rollIncidents(location: Location, rng: Rng): Incident[] {
  const incidents: Incident[] = [];
  for (const [key, perDayPercent] of Object.entries(location.probabilities.events)) {
    // Source weights are per-day chances; spread them across the 24 hours so a
    // 0.01% fatal fall stays a once-in-a-lifetime event rather than a daily one.
    if (rng.chance(perDayPercent / 24)) {
      incidents.push({
        key,
        label: INCIDENT_LABELS[key] ?? humanizeActivity(key),
        grave: GRAVE_INCIDENTS.has(key),
      });
    }
  }
  return incidents;
}

export function generateScene(input: SceneInput): Scene {
  const { day, hour, location, profiles, authored, ambience } = input;

  const existing = findAuthored(authored, day.day, hour, location.id);
  if (existing) return { kind: 'authored', ambience, event: existing };

  const weather = day.hourly.find((h) => h.hour === hour);
  if (!weather) return { kind: 'generated', ambience, activities: [], incidents: [] };

  const rng = createRng(hashSeed(day.day, hour, location.id));
  const isNight = weather.sunExposure === 'Dark';

  const weights = applyConditions(location.probabilities.activities, weather);
  const count = activityCount(weather, location.type === 'CENTRAL_DWELLING');

  const activities: ActivityOutcome[] = weightedSample(weights, count, rng).map((activity) => {
    const resolved = resolveActivity(activity, day.activitySuccessChance, { isNight });
    return {
      activity,
      successKey: resolved.successKey,
      label: humanizeActivity(resolved.successKey ?? activity),
      chance: resolved.chance,
      succeeded: rng.chance(resolved.chance),
      actors: chooseActors(profiles, activity, rng),
    };
  });

  return { kind: 'generated', ambience, activities, incidents: rollIncidents(location, rng) };
}
