/**
 * Reconciles the two activity vocabularies in the source data.
 *
 * Locations weight activities with one set of names
 * (`probabilities.activities`); days give success chances under a different,
 * partly-overlapping set (`activitySuccessChance`). Of the 44 location keys
 * and 38 success keys, only 20 match exactly. The rest split into:
 *
 *  - Location keys with no success chance (`gossiping`, `delousing`,
 *    `stargazing`, `butcheringAnimal`, ...). These are social and maintenance
 *    acts rather than resource acquisition, so they always succeed.
 *  - Success keys that *refine* a location key, often with seasonal variants:
 *    `fishingRiver` splits into salmon and trout, `foragingNuts` into
 *    hazelnuts, `trappingSmallGame` into arctic hare and birds.
 *
 * Picking the highest-scoring variant for the day is what surfaces the
 * seasonal signal already present in the data: `foragingHazelnuts` is 0 in
 * summer and 70 in autumn, `huntingReindeer` is 15 most of the year and 50 in
 * winter. The chosen variant also gives narration a specific noun to use —
 * "fishing for salmon" rather than "fishing".
 */
import type { ActivityKey, SuccessKey } from '../types.ts';

interface Mapping {
  /** Candidate success keys; the best-scoring one for the day wins. */
  variants: SuccessKey[];
  /** Used during dark hours regardless of score. */
  nightVariant?: SuccessKey;
  /** Used during dim hours (low sun, overcast) regardless of score. */
  dimVariant?: SuccessKey;
}

/**
 * Only activities whose success key differs from their location key need an
 * entry. The 20 exact matches resolve by name and are deliberately absent.
 */
export const ACTIVITY_SUCCESS_MAP: Readonly<Record<ActivityKey, Mapping>> = {
  fishingRiver: { variants: ['fishingRiverSalmon', 'fishingRiverTrout'] },
  foragingBerries: { variants: ['foragingWildStrawberries'] },
  foragingNuts: { variants: ['foragingHazelnuts'] },
  foragingRoots: { variants: ['foragingRootsAndTubers'] },
  trappingSmallGame: { variants: ['trappingArcticHare', 'trappingBirds'] },
  knappingFlint: { variants: ['knappingFlintBlades'] },
  exploring: { variants: ['exploringTerritory'] },
  makingMusic: { variants: ['singingOrChanting'] },
  // Reindeer have no location weight of their own but carry a strong winter
  // signal (15 -> 50), so they stand in as the cold-season red deer hunt.
  huntingRedDeer: { variants: ['huntingRedDeer', 'huntingReindeer'] },
  // Rest splits by light, not by odds. Competing on success chance would make
  // `napping` unreachable: it scores 75 against `restingEffectively`'s 80 every
  // day of the year, and `deepSleep` takes the night — so the highest-scoring
  // rule would never once pick it.
  restingEffectively: {
    variants: ['restingEffectively'],
    nightVariant: 'deepSleep',
    dimVariant: 'napping',
  },
};

/**
 * Success keys that no location weights, so nothing can select them.
 *
 * This is now empty: `huntingSeals`, `buildingHideTent`, `diggingStoragePit`,
 * `craftingAtlatl` and `engravingWithBurin` were given location weights in
 * `data/magdalenian_locations.json` and are all reachable. The export stays as
 * the documented escape hatch — if a future success key genuinely has nowhere
 * to live, list it here, and `tests/activity-map.test.ts` will hold the rest of
 * the vocabulary to full coverage.
 */
export const UNMAPPED_SUCCESS_KEYS: readonly SuccessKey[] = [];

export interface ResolvedActivity {
  activity: ActivityKey;
  /** The success key actually used, or null when nothing applies. */
  successKey: SuccessKey | null;
  /** 0-100. Activities with no success data always succeed. */
  chance: number;
}

/**
 * Resolves a location activity to the day's success chance, choosing between
 * seasonal variants. Activities with no mapping and no exact match always
 * succeed — they are social acts, not attempts that can fail.
 */
export function resolveActivity(
  activity: ActivityKey,
  successChances: Record<SuccessKey, number>,
  options: { isNight?: boolean; isDim?: boolean } = {},
): ResolvedActivity {
  const mapping = ACTIVITY_SUCCESS_MAP[activity];

  if (mapping) {
    // Darkness wins over dimness; both win over the highest-score rule.
    const forced = options.isNight
      ? mapping.nightVariant
      : options.isDim
        ? mapping.dimVariant
        : undefined;
    if (forced) {
      const forcedChance = successChances[forced];
      if (forcedChance !== undefined) {
        return { activity, successKey: forced, chance: forcedChance };
      }
    }

    let best: ResolvedActivity | null = null;
    for (const variant of mapping.variants) {
      const chance = successChances[variant];
      if (chance === undefined) continue;
      if (!best || chance > best.chance) best = { activity, successKey: variant, chance };
    }
    if (best) return best;
  }

  const exact = successChances[activity];
  if (exact !== undefined) return { activity, successKey: activity, chance: exact };

  return { activity, successKey: null, chance: 100 };
}

/** Display names for keys whose camelCase split reads badly. */
const LABELS: Readonly<Record<string, string>> = {
  huntingRedDeer: 'hunting red deer',
  huntingIbex: 'hunting ibex',
  huntingBison: 'hunting bison',
  huntingWildBoar: 'hunting wild boar',
  huntingReindeer: 'hunting reindeer',
  huntingSeals: 'hunting seals',
  trappingArcticHare: 'trapping arctic hare',
  trappingBirds: 'trapping birds',
  trappingSmallGame: 'trapping small game',
  fishingRiverSalmon: 'fishing for salmon',
  fishingRiverTrout: 'fishing for trout',
  fishingRiver: 'fishing the river',
  gatheringShellfish: 'gathering shellfish',
  foragingWildStrawberries: 'foraging wild strawberries',
  foragingHazelnuts: 'gathering hazelnuts',
  foragingRootsAndTubers: 'digging roots and tubers',
  foragingMushrooms: 'foraging mushrooms',
  knappingFlintBlades: 'knapping flint blades',
  knappingFlint: 'knapping flint',
  preparingHides: 'preparing hides',
  sewingTailoredClothing: 'sewing tailored clothing',
  makingJewelryFromShells: 'making shell jewellery',
  makingPigments: 'grinding pigments',
  weavingBaskets: 'weaving baskets',
  carvingAntler: 'carving antler',
  craftingAtlatl: 'shaping a spear-thrower',
  cavePainting: 'painting the cave wall',
  engravingWithBurin: 'engraving bone with a burin',
  buildingHideTent: 'raising a hide tent',
  diggingStoragePit: 'digging a storage pit',
  butcheringAnimal: 'butchering a carcass',
  smokingMeatOrFish: 'smoking meat',
  findingDryFirewood: 'gathering dry firewood',
  maintainingHearth: 'tending the hearth',
  maintainingLookout: 'keeping a lookout',
  restingEffectively: 'resting',
  napping: 'dozing',
  deepSleep: 'sleeping deeply',
  tellingStories: 'telling stories',
  childcare: 'minding the children',
  groupRitual: 'joining a rite',
  shamanicRitual: 'working a shamanic rite',
  exploringTerritory: 'ranging further out',
  exploring: 'exploring',
  makingMusic: 'making music',
  singingOrChanting: 'singing',
  dancing: 'dancing',
  gossiping: 'trading gossip',
  teachingChild: 'teaching a child',
  cleaningTeeth: 'cleaning their teeth',
  washingBody: 'washing',
  delousing: 'delousing',
  groomingAnother: 'grooming another',
  sexualRelations: 'lying together',
  masturbation: 'alone, unhurried',
  privateArgument: 'arguing quietly',
  comfortingSomeone: 'comforting someone',
  stargazing: 'watching the stars',
  meditatingOrTrance: 'sitting in trance',
};

/** camelCase -> spaced lower case, e.g. `foragingNuts` -> `foraging nuts`. */
export function humanizeActivity(key: string): string {
  return (
    LABELS[key] ??
    key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim()
  );
}
