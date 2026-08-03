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
 * Note the ordering and the deliberate omissions: "woman"/"man" wins over a
 * later "newborn" so mothers stay adults, and "young man"/"very young woman"
 * are adults, while "young girl"/"adolescent boy" are children.
 */
const AGE_PATTERNS: ReadonlyArray<readonly [AgeBand, RegExp]> = [
  ['elder', /\bold\b/i],
  ['adult', /\b(man|woman)\b/i],
  ['child', /\b(girl|boy|child|infant|adolescent)\b/i],
];

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

  let ageBand: AgeBand = 'adult';
  let evidence = `no age keyword in "${primary}"; defaulted to adult`;
  for (const [band, pattern] of AGE_PATTERNS) {
    const match = primary.match(pattern);
    if (match) {
      ageBand = band;
      evidence = `"${primary}" -> matched "${match[0]}"`;
      break;
    }
  }

  const roles = ROLE_PATTERNS.filter(([, pattern]) => pattern.test(blob)).map(([role]) => role);

  return { id: character.id, name: character.name, ageBand, roles, evidence };
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
