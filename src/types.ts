/**
 * Schemas for the five source datasets.
 *
 * These describe the JSON as it actually exists in `data/`, including its
 * quirks — most notably that location activity keys and day success-chance
 * keys are two different vocabularies (see `src/data/activity-map.ts`).
 */

export type Season = 'Summer' | 'Autumn' | 'Winter' | 'Spring';

export type MoonPhase =
  | 'New Moon'
  | 'Waxing Crescent'
  | 'First Quarter'
  | 'Waxing Gibbous'
  | 'Full Moon'
  | 'Waning Gibbous'
  | 'Last Quarter'
  | 'Waning Crescent';

export type SunExposure = 'Dark' | 'Low' | 'Overcast' | 'High' | 'Direct';

export type LocationType =
  | 'CENTRAL_DWELLING'
  | 'HUNTING_GROUND'
  | 'FORAGING_AREA'
  | 'RITUAL_SITE'
  | 'UTILITY_SITE'
  | 'SECONDARY_CAVE'
  | 'INTIMATE_SPOT'
  | 'MOUNTAIN_AREA';

/**
 * Activity identifiers are intentionally open strings rather than a closed
 * union: two locations carry unique bonus activities (`shamanicRitual` at
 * The Painted Cave, `huntingWildBoar` at The Boar's Wood), and more may be
 * added to the data without a code change.
 */
export type ActivityKey = string;
export type SuccessKey = string;
export type IncidentKey = string;

// --- Year data -------------------------------------------------------------

export interface HourlyWeather {
  hour: number;
  temp: number;
  precip: number;
  humidity: number;
  sunExposure: SunExposure;
}

export interface Tides {
  high1: string;
  low1: string;
  high2: string;
  low2: string;
}

/** Day-level metadata. Small enough (136 KB for all 365) to load upfront. */
export interface DayIndexEntry {
  year: number;
  day: number;
  season: Season;
  relativeEvent: string;
  moonPhase: MoonPhase;
  tideAmplitudeName: 'Neap' | 'Normal' | 'Spring';
  tideAmplitudeValue: number;
  cosmicEvent: string;
  wind: string;
  poeticComment: string;
  tides: Tides;
}

/** Per-day heavy payload, lazy-loaded one season at a time. */
export interface DayDetail {
  day: number;
  hourly: HourlyWeather[];
  activitySuccessChance: Record<SuccessKey, number>;
}

/** A full day, as the engine sees it once both slices are resolved. */
export interface ResolvedDay extends DayIndexEntry {
  hourly: HourlyWeather[];
  activitySuccessChance: Record<SuccessKey, number>;
}

export type YearIndex = DayIndexEntry[];
export type SeasonDetail = Record<string, DayDetail>;

// --- Locations -------------------------------------------------------------

export interface WalkTimes {
  meters: number;
  adultWalkMinutes: number;
  childWalkMinutes: number;
  elderWalkMinutes: number;
}

export interface LocationProbabilities {
  /** Relative weights, roughly 0-100. Not normalised. */
  activities: Record<ActivityKey, number>;
  /** Per-day incident chances as percentages, e.g. `fatalFall: 0.01`. */
  events: Record<IncidentKey, number>;
}

export interface Location {
  id: string;
  name: string;
  description: string;
  type: LocationType;
  distanceFromCenter: WalkTimes;
  probabilities: LocationProbabilities;
}

export type LocationsData = Record<string, Location>;

// --- Characters ------------------------------------------------------------

/** Raw shape: id, name, and ten free-text descriptions (`description0`..`9`). */
export interface Character {
  id: string;
  name: string;
  [description: string]: string;
}

export type CharactersData = Record<string, Character>;

/**
 * `infant` and `adolescent` exist to keep the simulation honest: infants are
 * never actors, and children need an adult present, while adolescents do not.
 */
export type AgeBand = 'infant' | 'child' | 'adolescent' | 'adult' | 'elder';

/** Bands that must never be assigned an activity of their own. */
export const NON_ACTORS: readonly AgeBand[] = ['infant'];

/** Bands that require a grown-up in the same scene. */
export const NEEDS_SUPERVISION: readonly AgeBand[] = ['child'];

/** Bands that can supervise a child. */
export const CAN_SUPERVISE: readonly AgeBand[] = ['adult', 'elder'];

/**
 * Derived from the prose descriptions by `scripts/build-data.ts`. This is a
 * keyword heuristic, not source data — the generated file is checked in so it
 * can be corrected by hand.
 */
export interface CharacterProfile {
  id: string;
  name: string;
  ageBand: AgeBand;
  /** Years, when the description states one ("a child of five winters"). */
  age?: number;
  /** Free-form role hints, e.g. `hunter`, `shaman`, `crafter`. */
  roles: string[];
  /** Why the heuristic decided what it did, for auditing. */
  evidence: string;
}

export type CharacterProfiles = Record<string, CharacterProfile>;

// --- Authored events -------------------------------------------------------

export interface DialogueLine {
  speakerId: string;
  line: string;
}

export interface DialogueContent {
  narration: string;
  dialogue: DialogueLine[];
}

export interface AuthoredProseEvent {
  day: number;
  hour: number;
  location: string;
  type: 'event';
  content: string;
}

export interface AuthoredDialogueEvent {
  day: number;
  hour: number;
  location: string;
  type: 'dialogue';
  content: DialogueContent;
}

export type AuthoredEvent = AuthoredProseEvent | AuthoredDialogueEvent;

export interface EventsData {
  schedule: AuthoredEvent[];
}

// --- Fallback ambience -----------------------------------------------------

export interface DefaultEvent {
  location_type: LocationType;
  event: string;
}

/** season -> hour (as a string key) -> one entry per location type. */
export type DefaultEventsData = Record<string, Record<string, DefaultEvent[]>>;
