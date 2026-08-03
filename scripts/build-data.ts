/**
 * Splits the 1.76 MB `magdalenian_year.json` into a small day-level index that
 * loads upfront and four per-season detail chunks that load on demand, and
 * copies the remaining datasets into `public/data/`.
 *
 * Also derives `data/character-profiles.json` if it is missing. That file is
 * checked in and hand-editable: once it exists this script leaves it alone, so
 * manual corrections to the keyword heuristic are never clobbered.
 *
 * Run via `npm run build:data` (automatically before `dev` and `build`).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgeBand,
  CharacterProfile,
  CharacterProfiles,
  CharactersData,
  DayDetail,
  DayIndexEntry,
  SeasonDetail,
} from '../src/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data');
const OUT = join(ROOT, 'public', 'data');

/** Raw day record as it appears in the source file, before splitting. */
interface RawDay extends DayIndexEntry {
  hourly: DayDetail['hourly'];
  activitySuccessChance: DayDetail['activitySuccessChance'];
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(SRC, name), 'utf8')) as T;
}

function writeJson(name: string, value: unknown): number {
  const json = JSON.stringify(value);
  writeFileSync(join(OUT, name), json);
  return Buffer.byteLength(json);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

// --- Character profile derivation ------------------------------------------

/**
 * Age is read from `description0` alone, which is a consistent physical
 * descriptor for all 43 characters ("An old, thin man", "A young girl",
 * "A man in his prime"). Scanning all ten descriptions instead picks up
 * mentions of *other* people — it tagged Lurra ("A patient woman") as a child
 * because another line mentions her children, and Unai ("A man in his prime")
 * as an elder via "eldest son".
 *
 * Order matters. "woman"/"man" is checked before the young-person words so
 * "A woman with a newborn" stays an adult, and "adolescent" is checked before
 * "girl"/"boy" so "An adolescent boy" does not come out as a child.
 */
const AGE_PATTERNS: ReadonlyArray<readonly [AgeBand, RegExp]> = [
  ['elder', /\bold\b/i],
  ['adult', /\b(man|woman)\b/i],
  ['infant', /\b(infant|newborn|babe)\b/i],
  ['adolescent', /\badolescent\b/i],
  ['child', /\b(girl|boy|child)\b/i],
];

/** Stated ages are written as words: "a child of five winters". */
const WORD_NUMBERS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function statedAge(description: string): number | undefined {
  const match = description.match(/\b(\w+)\s+winters\b/i);
  if (!match?.[1]) return undefined;
  const word = match[1].toLowerCase();
  return WORD_NUMBERS[word] ?? (Number.isFinite(Number(word)) ? Number(word) : undefined);
}

/** A stated age is more precise than any keyword, so it wins outright. */
function bandForAge(age: number): AgeBand {
  if (age < 2) return 'infant';
  if (age < 10) return 'child';
  if (age < 16) return 'adolescent';
  return 'adult';
}

const ROLE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['hunter', /\b(hunt|hunter|hunting|spear|atlatl|tracker|tracking)\b/i],
  ['shaman', /\b(shaman|spirit|spirits|ritual|trance|sacred|omen)\b/i],
  ['crafter', /\b(carv|knapp|flint|sew|sewing|hide|hides|weav|basket|tool)\b/i],
  ['forager', /\b(forag|gather|berr|root|mushroom|nut)\b/i],
  ['fisher', /\b(fish|fishing|river|net|shellfish)\b/i],
  ['storyteller', /\b(story|stories|storyteller|tale|tales|song|sing)\b/i],
  ['healer', /\b(heal|healer|medicin|herb|remed)\b/i],
  ['artist', /\b(paint|painting|pigment|engrav|ochre|art)\b/i],
  ['lookout', /\b(watch|watchful|vigilant|lookout|guard|sentr)\b/i],
];

function descriptionsOf(character: CharactersData[string]): string[] {
  return Object.entries(character)
    .filter(([key]) => key.startsWith('description'))
    .map(([, value]) => value);
}

function deriveProfile(character: CharactersData[string]): CharacterProfile {
  const descriptions = descriptionsOf(character);
  const blob = descriptions.join(' ');
  const primary = character.description0 ?? '';

  const age = statedAge(primary);

  let ageBand: AgeBand = 'adult';
  let evidence = `no age keyword in "${primary}"; defaulted to adult`;

  if (age !== undefined) {
    ageBand = bandForAge(age);
    evidence = `"${primary}" -> stated age ${age}`;
  } else {
    for (const [band, pattern] of AGE_PATTERNS) {
      const match = primary.match(pattern);
      if (match) {
        ageBand = band;
        evidence = `"${primary}" -> matched "${match[0]}"`;
        break;
      }
    }
    // "A small child" is younger than a bare "child" and should not be out
    // foraging unsupervised on the strength of the same keyword.
    if (ageBand === 'child' && /\bsmall\b/i.test(primary)) {
      evidence = `"${primary}" -> matched "small child"`;
    }
  }

  const roles = ROLE_PATTERNS.filter(([, pattern]) => pattern.test(blob)).map(([role]) => role);

  return { id: character.id, name: character.name, ageBand, ...(age !== undefined && { age }), roles, evidence };
}

function loadOrDeriveProfiles(characters: CharactersData): CharacterProfiles {
  const checkedIn = join(SRC, 'character-profiles.json');
  if (existsSync(checkedIn)) {
    console.log('  character-profiles.json  (existing, hand-editable — not regenerated)');
    return JSON.parse(readFileSync(checkedIn, 'utf8')) as CharacterProfiles;
  }

  const profiles: CharacterProfiles = {};
  for (const [id, character] of Object.entries(characters)) {
    profiles[id] = deriveProfile(character);
  }
  writeFileSync(checkedIn, `${JSON.stringify(profiles, null, 2)}\n`);

  const counts = Object.values(profiles).reduce<Record<string, number>>((acc, p) => {
    acc[p.ageBand] = (acc[p.ageBand] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `  character-profiles.json  (derived: ${Object.entries(counts)
      .map(([band, n]) => `${n} ${band}`)
      .join(', ')})`,
  );
  return profiles;
}

// --- Main ------------------------------------------------------------------

function main(): void {
  mkdirSync(OUT, { recursive: true });

  const year = readJson<RawDay[]>('magdalenian_year.json');

  const index: DayIndexEntry[] = [];
  const bySeason: Record<string, SeasonDetail> = {};

  for (const day of year) {
    const { hourly, activitySuccessChance, ...meta } = day;
    index.push(meta);
    // Chunk by each day's own `season` field rather than by assumed date
    // ranges, so the split can never disagree with the data.
    (bySeason[day.season] ??= {})[String(day.day)] = {
      day: day.day,
      hourly,
      activitySuccessChance,
    };
  }

  console.log('Writing public/data/');
  console.log(`  year-index.json          ${kb(writeJson('year-index.json', index))}  (${index.length} days)`);

  for (const [season, detail] of Object.entries(bySeason)) {
    const name = `year-detail-${season.toLowerCase()}.json`;
    const size = writeJson(name, detail);
    console.log(`  ${name.padEnd(24)} ${kb(size)}  (${Object.keys(detail).length} days)`);
  }

  const characters = readJson<CharactersData>('magdalenian_characters.json');
  const profiles = loadOrDeriveProfiles(characters);

  const copies: Array<[string, string]> = [
    ['magdalenian_locations.json', 'locations.json'],
    ['magdalenian_characters.json', 'characters.json'],
    ['magdalenian_events.json', 'events.json'],
    ['magdalenian_default_events.json', 'default-events.json'],
  ];
  for (const [from, to] of copies) {
    console.log(`  ${to.padEnd(24)} ${kb(writeJson(to, readJson(from)))}`);
  }
  console.log(`  ${'character-profiles.json'.padEnd(24)} ${kb(writeJson('character-profiles.json', profiles))}`);
}

main();
