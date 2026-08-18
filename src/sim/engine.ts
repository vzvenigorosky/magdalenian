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
import {
  CAN_SUPERVISE,
  NEEDS_SUPERVISION,
  NON_ACTORS,
  type AgeBand,
  type AuthoredEvent,
  type CharacterProfile,
  type CharacterProfiles,
  type DefaultEventsData,
  type IncidentKey,
  EMPTY_KIN,
  type Kin,
  type Location,
  type Relationships,
  type ResolvedDay,
} from '../types.ts';
import { resolveActivity, humanizeActivity } from '../data/activity-map.ts';
import { assertsPeoplePresent, toAmbience, type Ambience } from './ambience.ts';
import { createRng, hashSeed, weightedSample, type Rng } from './rng.ts';
import { activityCount, applyConditions, canReach, isCoastal, traitsOf } from './weights.ts';
import { moonlight, tideStateAt, type TideState } from './sky.ts';

export interface ActivityOutcome {
  activity: string;
  /** The specific success key chosen, e.g. `huntingReindeer`. */
  successKey: string | null;
  label: string;
  chance: number;
  succeeded: boolean;
  actors: CharacterProfile[];
  /** For childminding: the children being minded, who are not doing the minding. */
  charges?: CharacterProfile[];
}

export interface Incident {
  key: IncidentKey;
  label: string;
  /** True for the rare, severe entries — used to set narration tone. */
  grave: boolean;
}

/**
 * The conditions the scene happens in, carried on the scene itself so the
 * narrator can weave them into the prose without needing the day and location
 * handed to it separately.
 */
export interface SceneConditions {
  season: string;
  hour: number;
  temp: number;
  precip: number;
  sunExposure: string;
  wind: string;
  moonlight: number;
  cosmicEvent: string;
  /** Only meaningful at the two shore sites. */
  tide: TideState | null;
}

export interface GeneratedScene {
  kind: 'generated';
  ambience: Ambience;
  activities: ActivityOutcome[];
  incidents: Incident[];
  conditions: SceneConditions;
}

export interface AuthoredScene {
  kind: 'authored';
  ambience: Ambience;
  event: AuthoredEvent;
}

export type Scene = AuthoredScene | GeneratedScene;

export interface SceneInput {
  day: ResolvedDay;
  hour: number;
  location: Location;
  profiles: CharacterProfiles;
  relationships: Relationships;
  authored: AuthoredEvent[];
  ambience: Ambience;
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
  [/^(knapping|carving|crafting|sewing|weaving|preparing|making|building|digging)/, 'crafter'],
  [/(Ritual|meditating)/, 'shaman'],
  [/^(cavePainting|makingPigments|engraving)/, 'artist'],
  [/^tellingStories/, 'storyteller'],
  [/^maintainingLookout/, 'lookout'],
];

/**
 * Everyone a character is closely tied to. The band is small and related, so
 * kinship is the strongest signal available for who plausibly does what with
 * whom — it beats picking bodies at random out of 43.
 */
function kinOf(relationships: Relationships, id: string): Kin {
  return relationships[id] ?? EMPTY_KIN;
}

/**
 * Activities where being family is the point, and how strongly.
 *
 * The multipliers look extreme because they compete against the whole band: a
 * 12x boost for the one mate among 42 other candidates still lands at only
 * ~22% mates, which is not what "lying together" should mean. Lying together
 * is near-exclusive to mates; foraging alongside a sister is merely likelier
 * than foraging with a stranger.
 */
/** Activities that should be between mates whenever a couple is available. */
const PAIR_WITH_MATE = /^sexualRelations$/;

/**
 * Close kin who must never be paired for intimacy. A preference for mates is
 * not enough on its own — it leaves the remainder free to pair siblings, which
 * the grid duly produced.
 */
const INCEST_SIDES: ReadonlyArray<keyof Kin> = [
  'parents',
  'children',
  'siblings',
  'grandparents',
  'grandchildren',
];

function isForbiddenPairing(
  relationships: Relationships,
  activity: string,
  chosen: readonly CharacterProfile[],
  candidateId: string,
): boolean {
  if (!PAIR_WITH_MATE.test(activity)) return false;
  return chosen.some((already) => {
    const kin = kinOf(relationships, already.id);
    return INCEST_SIDES.some((side) => kin[side].includes(candidateId));
  });
}

const KIN_AFFINITY: ReadonlyArray<readonly [RegExp, ReadonlyArray<keyof Kin>, number]> = [
  [/^sexualRelations$/, ['mates'], 400],
  [/^(comfortingSomeone|groomingAnother|delousing)$/, ['mates', 'children', 'siblings'], 40],
  [/^tellingStories$/, ['grandchildren', 'children'], 25],
  [/^(foragingBerries|foragingNuts|foragingRoots|foragingMushrooms|gatheringShellfish)$/, ['siblings', 'mates'], 15],
];

/**
 * Boosts characters related to whoever is already doing this activity, so
 * scenes read as a band of families rather than a random draw: mates lie
 * together, an elder teaches his own grandchildren, siblings forage as a pair.
 */
function kinBoost(
  relationships: Relationships,
  activity: string,
  chosen: readonly CharacterProfile[],
  candidateId: string,
): number {
  if (chosen.length === 0) return 1;
  const entry = KIN_AFFINITY.find(([pattern]) => pattern.test(activity));
  if (!entry) return 1;
  const [, sides, strength] = entry;

  for (const already of chosen) {
    const kin = kinOf(relationships, already.id);
    for (const side of sides) {
      if (kin[side].includes(candidateId)) return strength;
    }
  }
  return 1;
}

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
  defaultEvents: DefaultEventsData,
  season: string,
  hour: number,
  locationType: string,
): Ambience {
  const entry = defaultEvents[season]?.[String(hour)]?.find((e) => e.location_type === locationType);
  return toAmbience(entry);
}

function eligibleActors(
  profiles: CharacterProfiles,
  activity: string,
  location: Location,
): CharacterProfile[] {
  const traits = traitsOf(activity);
  return Object.values(profiles).filter((profile) => {
    // Infants are carried, fed and minded — never the doers of anything.
    if (NON_ACTORS.includes(profile.ageBand)) return false;
    // Nobody is somewhere they would not have walked to.
    if (!canReach(profile.ageBand, location)) return false;
    if (traits.strenuous && profile.ageBand !== 'adult') return false;
    // Grown-up business: adults and elders, never minors.
    if (traits.adultOnly && !CAN_SUPERVISE.includes(profile.ageBand)) return false;
    return true;
  });
}

/**
 * `taken` holds everyone already busy elsewhere in this scene, so nobody ends
 * up minding the children and sleeping through it at the same time.
 */
function chooseActors(
  profiles: CharacterProfiles,
  relationships: Relationships,
  activity: string,
  location: Location,
  rng: Rng,
  taken: Set<string>,
): CharacterProfile[] {
  const pool = eligibleActors(profiles, activity, location).filter((p) => !taken.has(p.id));
  if (pool.length === 0) return [];

  const affinity = ROLE_AFFINITY.find(([pattern]) => pattern.test(activity))?.[1];

  // For activities that are near-exclusive to couples, seed the draw from
  // someone whose mate is actually free. Boosting the *second* pick alone is
  // not enough: if the first person drawn has no mate here, no boost can
  // produce a couple, which left 42% of intimate scenes between strangers.
  const pairFirst =
    PAIR_WITH_MATE.test(activity) &&
    pool.filter((p) => kinOf(relationships, p.id).mates.some((m) => !taken.has(m)));
  const seedPool = pairFirst && pairFirst.length > 0 ? pairFirst : pool;

  const wanted = Math.min(
    activity === 'groupRitual' ? rng.int(2, 3) : activity === 'teachingChild' ? 1 : rng.int(1, 2),
    pool.length,
  );

  // Drawn one at a time rather than in a single sample, because the kin boost
  // depends on who has already been picked: the second forager is chosen partly
  // for being the first one's sister.
  const chosen: CharacterProfile[] = [];
  const remaining = new Map(pool.map((p) => [p.id, p]));

  while (chosen.length < wanted) {
    const weights: Record<string, number> = {};
    const candidates = chosen.length === 0 ? seedPool : [...remaining.values()];
    for (const profile of candidates) {
      const id = profile.id;
      if (!remaining.has(id)) continue;
      // Characters whose derived roles suit the activity are likelier to appear,
      // so the band reads as having specialists rather than interchangeable bodies.
      if (isForbiddenPairing(relationships, activity, chosen, id)) continue;
      const role = affinity && profile.roles.includes(affinity) ? 8 : 1;
      weights[id] = role * kinBoost(relationships, activity, chosen, id);
    }

    const picked = weightedSample(weights, 1, rng)[0];
    const profile = picked === undefined ? undefined : remaining.get(picked);
    if (!profile) break;
    chosen.push(profile);
    remaining.delete(profile.id);
  }

  for (const profile of chosen) taken.add(profile.id);
  return chosen;
}

/** Bands that need minding. Adolescents look after themselves. */
const NEEDS_MINDING: readonly AgeBand[] = ['infant', 'child'];

/** Activities that are meaningless without a child attached to them. */
const NEEDS_A_CHILD = new Set(['childcare', 'teachingChild']);

/** Bands who can be taught: old enough to learn a craft, young enough to need to. */
const CAN_BE_TAUGHT: readonly AgeBand[] = ['child', 'adolescent'];

/**
 * Attaches the child being taught to a `teachingChild` activity.
 *
 * The activity is `adultOnly`, which correctly keeps children from being the
 * *teacher* — but left alone it produced two adults "teaching a child" with no
 * child anywhere in the scene. The pupil is a charge, exactly as the minded
 * children are, and a teacher's own child or grandchild is by far the likeliest.
 */
function attachPupils(
  teacher: ActivityOutcome,
  profiles: CharacterProfiles,
  relationships: Relationships,
  location: Location,
  taken: Set<string>,
  rng: Rng,
): ActivityOutcome | null {
  const free = Object.values(profiles).filter(
    (p) => !taken.has(p.id) && CAN_BE_TAUGHT.includes(p.ageBand) && canReach(p.ageBand, location),
  );
  if (free.length === 0) return null;

  const weights: Record<string, number> = {};
  for (const pupil of free) {
    const own = teacher.actors.some((t) => {
      const kin = kinOf(relationships, t.id);
      return kin.children.includes(pupil.id) || kin.grandchildren.includes(pupil.id);
    });
    weights[pupil.id] = own ? 60 : 1;
  }

  const pupils = weightedSample(weights, rng.int(1, 2), rng)
    .map((id) => profiles[id])
    .filter((p): p is CharacterProfile => p !== undefined);
  if (pupils.length === 0) return null;

  for (const pupil of pupils) taken.add(pupil.id);
  return { ...teacher, charges: pupils };
}

/**
 * The most grown-ups who could plausibly be minding a given number of children.
 *
 * One or two adults can handle a large group perfectly well — this is not a
 * modern nursery. What does not happen is four adults hovering over a single
 * child, which is what an unbounded draw produced.
 */
export function minderCap(children: number): number {
  if (children <= 0) return 0;
  if (children <= 4) return 2;
  if (children <= 8) return 3;
  return 4;
}

/**
 * Builds the childminding line, or nothing when there are no children here.
 *
 * Childminding is a background task rather than an exclusive one, so minders
 * are drawn from grown-ups who may already be doing something else — you watch
 * the children *while* you scrape a hide. The one exclusion is work that takes
 * you away or takes both hands and full attention: nobody minds a toddler
 * halfway through a bison hunt.
 */
function buildChildcare(
  profiles: CharacterProfiles,
  relationships: Relationships,
  location: Location,
  successChances: Record<string, number>,
  taken: Set<string>,
  busyWithHardWork: Set<string>,
  rng: Rng,
): ActivityOutcome | null {
  // Children are only minded where children would actually be.
  const everyone = Object.values(profiles).filter((p) => canReach(p.ageBand, location));

  // Children already doing something here are being watched over too.
  const present = everyone.filter((p) => taken.has(p.id) && NEEDS_MINDING.includes(p.ageBand));
  const free = everyone.filter((p) => !taken.has(p.id) && NEEDS_MINDING.includes(p.ageBand));

  // Infants are always with someone, so they are the likeliest to be here.
  const dependentWeights: Record<string, number> = {};
  for (const child of free) dependentWeights[child.id] = child.ageBand === 'infant' ? 6 : 3;
  const dependents = weightedSample(dependentWeights, rng.int(1, 3), rng)
    .map((id) => profiles[id])
    .filter((p): p is CharacterProfile => p !== undefined);

  const charges = [...present, ...dependents];
  if (charges.length === 0) return null; // nobody to mind

  const pool = eligibleActors(profiles, 'childcare', location).filter(
    (p) => !busyWithHardWork.has(p.id) && !charges.some((c) => c.id === p.id),
  );
  if (pool.length === 0) return null;

  const wanted = Math.min(rng.int(1, minderCap(charges.length)), pool.length);

  // A child's own mother, father or grandparent is far and away the likeliest
  // person to be watching them.
  const minderWeights: Record<string, number> = {};
  for (const p of pool) {
    const kin = kinOf(relationships, p.id);
    const ownChild = charges.some((c) => kin.children.includes(c.id));
    const ownGrandchild = charges.some((c) => kin.grandchildren.includes(c.id));
    const storyteller = p.roles.includes('storyteller') ? 3 : 1;
    minderWeights[p.id] = storyteller * (ownChild ? 25 : ownGrandchild ? 12 : 1);
  }

  const minders = weightedSample(minderWeights, wanted, rng)
    .map((id) => profiles[id])
    .filter((p): p is CharacterProfile => p !== undefined);
  if (minders.length === 0) return null;

  for (const minder of minders) taken.add(minder.id);

  // Childminding carries a success chance in the data like anything else, even
  // though narration treats it as outcome-neutral.
  const resolved = resolveActivity('childcare', successChances);
  return {
    activity: 'childcare',
    successKey: resolved.successKey,
    label: humanizeActivity('childcare'),
    chance: resolved.chance,
    succeeded: rng.chance(resolved.chance),
    actors: minders,
    charges,
  };
}

/**
 * Guarantees a grown-up wherever a child is.
 *
 * Supervision is judged across the whole scene, not per activity: a child
 * foraging while an adult knaps flint a few paces away is supervised. Only
 * when a scene contains children and no adult or elder at all does this step
 * pull one in, joining the activity the children are already doing.
 */
function enforceSupervision(
  activities: ActivityOutcome[],
  profiles: CharacterProfiles,
  relationships: Relationships,
  location: Location,
  rng: Rng,
): ActivityOutcome[] {
  const everyone = activities.flatMap((a) => a.actors);
  const hasChild = everyone.some((p) => NEEDS_SUPERVISION.includes(p.ageBand));
  if (!hasChild) return activities;
  if (everyone.some((p) => CAN_SUPERVISE.includes(p.ageBand))) return activities;

  const index = activities.findIndex((a) =>
    a.actors.some((p) => NEEDS_SUPERVISION.includes(p.ageBand)),
  );
  const target = activities[index];
  if (!target) return activities;

  const busy = new Set(everyone.map((p) => p.id));
  const candidates = eligibleActors(profiles, target.activity, location).filter(
    (p) => CAN_SUPERVISE.includes(p.ageBand) && !busy.has(p.id),
  );

  // A parent or grandparent of the child is the natural person to step in.
  const children = target.actors.filter((p) => NEEDS_SUPERVISION.includes(p.ageBand));
  const relatives = candidates.filter((p) => {
    const kin = kinOf(relationships, p.id);
    return children.some((c) => kin.children.includes(c.id) || kin.grandchildren.includes(c.id));
  });

  const chosen = rng.pick(relatives.length > 0 ? relatives : candidates);
  if (chosen) {
    activities[index] = { ...target, actors: [chosen, ...target.actors] };
    return activities;
  }

  // No grown-up can join this activity, so the children cannot be doing it.
  return activities.filter((_, i) => i !== index);
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
  const { day, hour, location, profiles, relationships, authored, ambience } = input;

  const existing = findAuthored(authored, day.day, hour, location.id);
  if (existing) return { kind: 'authored', ambience, event: existing };

  const weather = day.hourly.find((h) => h.hour === hour);
  if (!weather) {
    return {
      kind: 'generated',
      ambience,
      activities: [],
      incidents: [],
      conditions: {
        season: day.season,
        hour,
        temp: 0,
        precip: 0,
        sunExposure: 'Dark',
        wind: day.wind,
        moonlight: moonlight(day.moonPhase),
        cosmicEvent: day.cosmicEvent,
        tide: null,
      },
    };
  }

  const conditions: SceneConditions = {
    season: day.season,
    hour,
    temp: weather.temp,
    precip: weather.precip,
    sunExposure: weather.sunExposure,
    wind: day.wind,
    moonlight: weather.sunExposure === 'Dark' ? moonlight(day.moonPhase) : 0,
    cosmicEvent: day.cosmicEvent,
    tide: isCoastal(location) ? tideStateAt(day.tides, hour) : null,
  };

  const rng = createRng(hashSeed(day.day, hour, location.id));
  const isNight = weather.sunExposure === 'Dark';
  const isDim = weather.sunExposure === 'Low' || weather.sunExposure === 'Overcast';

  const weights = applyConditions(location.probabilities.activities, weather, day, hour, location);

  let count = activityCount(location, weather, day, rng);
  // The ambience data encodes when a place is normally busy ("A hunting party
  // moves through the area"), so don't empty a location its own line says is
  // occupied — that would contradict the framing in the other direction.
  if (count === 0 && assertsPeoplePresent(ambience)) count = 1;

  const keys = weightedSample(weights, count, rng);

  // Childminding is resolved last: it depends on who else is here and, above
  // all, on whether there are any children to mind.
  const wantsChildcare = keys.includes('childcare');

  const taken = new Set<string>();
  const busyWithHardWork = new Set<string>();

  const drawn: ActivityOutcome[] = keys
    .filter((activity) => activity !== 'childcare')
    .map((activity) => {
      const resolved = resolveActivity(activity, day.activitySuccessChance, { isNight, isDim });
      const actors = chooseActors(profiles, relationships, activity, location, rng, taken);
      const traits = traitsOf(activity);
      if (traits.strenuous || traits.outdoor) {
        for (const actor of actors) busyWithHardWork.add(actor.id);
      }
      const outcome: ActivityOutcome = {
        activity,
        successKey: resolved.successKey,
        label: humanizeActivity(resolved.successKey ?? activity),
        chance: resolved.chance,
        succeeded: rng.chance(resolved.chance),
        actors,
      };

      // Teaching needs someone to teach; without a pupil it is not happening.
      if (activity === 'teachingChild' && actors.length > 0) {
        return attachPupils(outcome, profiles, relationships, location, taken, rng);
      }
      return outcome;
    })
    .filter((outcome): outcome is ActivityOutcome => outcome !== null)
    // Nobody left free to do it means it isn't happening.
    .filter((outcome) => outcome.actors.length > 0);

  const childcare = wantsChildcare
    ? buildChildcare(profiles, relationships, location, day.activitySuccessChance, taken, busyWithHardWork, rng)
    : null;
  if (childcare) drawn.push(childcare);

  // The ambience promised people at work here, but everything drawn may have
  // fallen through — childminding four kilometres out has no children to mind.
  // Draw again from the activities that can actually be staffed.
  if (drawn.length === 0 && assertsPeoplePresent(ambience)) {
    // Exclude the activities that need a child attached to them, since a lack
    // of reachable children is the usual reason we are here at all.
    const staffable = Object.fromEntries(
      Object.entries(weights).filter(([activity]) => !NEEDS_A_CHILD.has(activity)),
    );
    for (const activity of weightedSample(staffable, 3, rng)) {
      const actors = chooseActors(profiles, relationships, activity, location, rng, taken);
      if (actors.length === 0) continue;
      const resolved = resolveActivity(activity, day.activitySuccessChance, { isNight, isDim });
      drawn.push({
        activity,
        successKey: resolved.successKey,
        label: humanizeActivity(resolved.successKey ?? activity),
        chance: resolved.chance,
        succeeded: rng.chance(resolved.chance),
        actors,
      });
      break;
    }
  }

  const activities = enforceSupervision(drawn, profiles, relationships, location, rng);

  // Nobody here means nothing happens to anybody here.
  const incidents = activities.length > 0 ? rollIncidents(location, rng) : [];

  return { kind: 'generated', ambience, activities, incidents, conditions };
}
