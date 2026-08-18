/**
 * Authoring tools for hand-written scenes.
 *
 *   npm run events -- context 200 13 "The Whispering Valley"
 *   npm run events -- new 200 13 "The Whispering Valley"
 *   npm run events -- suggest
 *   npm run events -- check
 *   npm run events -- coverage
 *
 * The point of `context` is that writing a scene needs the same facts the
 * engine has — the weather, the light, who could plausibly be standing there,
 * what the procedural layer would otherwise have said — and hunting through
 * four JSON files for them is what stops people writing.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  CharacterProfiles,
  CharactersData,
  LocationsData,
  Relationships,
  ResolvedDay,
} from '../src/types.ts';
import { expandAmbience, phaseForHour, type AmbienceSource } from '../src/data/ambience-source.ts';
import { compileEvents, EventCompileError, type SourceDay } from '../src/data/events-source.ts';
import { findAmbience, generateScene } from '../src/sim/engine.ts';
import { narrateScene } from '../src/sim/narrate.ts';
import { cosmicKind, tideStateAt } from '../src/sim/sky.ts';
import { canReach, presenceChance } from '../src/sim/weights.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const EVENTS = join(DATA, 'events');

const read = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(DATA, ...parts), 'utf8')) as T;

const year = read<Array<Record<string, unknown>>>('magdalenian_year.json');
const locations = read<LocationsData>('magdalenian_locations.json');
const characters = read<CharactersData>('magdalenian_characters.json');
const profiles = read<CharacterProfiles>('character-profiles.json');
const relationships = read<Relationships>('relationships.json');
const defaultEvents = expandAmbience(read<AmbienceSource>('ambience', 'ambience.json'));

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const ochre = (s: string) => `\x1b[38;5;180m${s}\x1b[0m`;

function loadSources(): SourceDay[] {
  if (!existsSync(EVENTS)) return [];
  return readdirSync(EVENTS)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(EVENTS, f), 'utf8')) as SourceDay);
}

function dayOf(day: number): ResolvedDay {
  const found = year.find((d) => d.day === day);
  if (!found) {
    console.error(`No day ${day}. The year runs 1 to 365.`);
    process.exit(1);
  }
  return found as unknown as ResolvedDay;
}

function locationByName(name: string) {
  const entry = Object.values(locations).find(
    (l) => l.name.toLowerCase() === name.toLowerCase() || l.id === name,
  );
  if (!entry) {
    console.error(`No place called "${name}". Places are:\n  ${Object.values(locations).map((l) => l.name).join('\n  ')}`);
    process.exit(1);
  }
  return entry;
}

// --- context ---------------------------------------------------------------

function showContext(day: number, hour: number, placeName: string): void {
  const resolved = dayOf(day);
  const location = locationByName(placeName);
  const weather = resolved.hourly.find((h) => h.hour === hour);
  if (!weather) {
    console.error(`No hour ${hour}. Hours run 0 to 23.`);
    process.exit(1);
  }

  console.log(`\n${bold(`Day ${day}, hour ${hour} — ${location.name}`)}`);
  console.log(dim(`${resolved.season} · ${resolved.relativeEvent} · ${phaseForHour(hour)}`));
  console.log(`\n${ochre('Sky and weather')}`);
  console.log(`  ${weather.temp}°C, ${weather.sunExposure.toLowerCase()}${weather.precip > 0 ? `, rain ${weather.precip}` : ''}, humidity ${weather.humidity}%`);
  console.log(`  wind: ${resolved.wind}`);
  console.log(`  moon: ${resolved.moonPhase}`);
  if (resolved.cosmicEvent && resolved.cosmicEvent !== 'None') {
    console.log(`  ${bold('cosmic:')} ${resolved.cosmicEvent} (${cosmicKind(resolved.cosmicEvent)})`);
  }
  console.log(`  tide: ${tideStateAt(resolved.tides, hour)} — high ${resolved.tides.high1}/${resolved.tides.high2}, low ${resolved.tides.low1}/${resolved.tides.low2}`);
  console.log(`  "${resolved.poeticComment}"`);

  console.log(`\n${ochre('Place')}`);
  console.log(`  ${location.description}`);
  console.log(dim(`  ${location.type} · ${location.distanceFromCenter.meters} m · ${location.distanceFromCenter.adultWalkMinutes} min adult walk`));
  console.log(dim(`  chance anyone is here this hour: ${Math.round(presenceChance(location, weather, resolved))}%`));

  const reachable = Object.values(profiles).filter((p) => canReach(p.ageBand, location));
  const byBand = new Map<string, string[]>();
  for (const p of reachable) {
    byBand.set(p.ageBand, [...(byBand.get(p.ageBand) ?? []), p.name]);
  }
  console.log(`\n${ochre('Who could be here')} ${dim(`(${reachable.length} of ${Object.keys(profiles).length})`)}`);
  for (const band of ['elder', 'adult', 'adolescent', 'child', 'infant']) {
    const names = byBand.get(band);
    if (names?.length) console.log(`  ${band.padEnd(11)} ${names.join(', ')}`);
  }
  const barred = Object.values(profiles).filter((p) => !canReach(p.ageBand, location));
  if (barred.length) console.log(dim(`  too far for: ${barred.map((p) => p.name).join(', ')}`));

  const ambience = findAmbience(defaultEvents, resolved.season, hour, location.type);
  console.log(`\n${ochre('Ambience for this cell')} ${dim(`(${ambience.presence})`)}`);
  console.log(`  ${ambience.text}`);

  const scene = generateScene({
    day: resolved,
    hour,
    location,
    profiles,
    relationships,
    authored: [],
    ambience,
  });
  console.log(`\n${ochre('What the engine says now')} ${dim('(this is what your scene would replace)')}`);
  if (scene.kind === 'generated') {
    const text = narrateScene(scene, `${day}:${hour}:${location.id}`)
      .replace(/<\/p>/g, '\n  ')
      .replace(/<[^>]+>/g, '')
      .trim();
    console.log(`  ${text || dim('(nobody here)')}`);
  }

  const existing = loadSources().find((d) => d.day === day)?.scenes.find(
    (s) => s.hour === hour && s.at === location.name,
  );
  if (existing) console.log(`\n${bold('This cell is already written.')}`);
  console.log(`\n${dim(`To scaffold it:  npm run events -- new ${day} ${hour} "${location.name}"`)}\n`);
}

// --- new -------------------------------------------------------------------

function scaffold(day: number, hour: number, placeName: string, dialogue: boolean): void {
  const resolved = dayOf(day);
  const location = locationByName(placeName);
  const weather = resolved.hourly.find((h) => h.hour === hour);
  if (!weather) {
    console.error(`No hour ${hour}. Hours run 0 to 23.`);
    process.exit(1);
  }

  mkdirSync(EVENTS, { recursive: true });
  const path = join(EVENTS, `day-${String(day).padStart(3, '0')}.json`);
  const source: SourceDay = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as SourceDay)
    : { day, scenes: [] };

  if (source.scenes.some((s) => s.hour === hour && s.at === location.name)) {
    console.error(`Day ${day} hour ${hour} at ${location.name} is already written in ${path}.`);
    process.exit(1);
  }

  const note = [
    `${resolved.season}, ${phaseForHour(hour)}`,
    `${weather.temp}°C ${weather.sunExposure.toLowerCase()}${weather.precip > 0 ? ` rain ${weather.precip}` : ''}`,
    resolved.wind,
    resolved.moonPhase,
    resolved.cosmicEvent !== 'None' ? resolved.cosmicEvent : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const scene = dialogue
    ? {
        hour,
        at: location.name,
        _note: note,
        narration: '',
        dialogue: [{ speaker: '', line: '' }],
      }
    : { hour, at: location.name, _note: note, text: '' };

  source.scenes.push(scene as SourceDay['scenes'][number]);
  source.scenes.sort((a, b) => a.hour - b.hour || a.at.localeCompare(b.at));
  writeFileSync(path, `${JSON.stringify(source, null, 2)}\n`);

  console.log(`${existsSync(path) ? 'Updated' : 'Created'} ${path}`);
  console.log(dim(`  added an empty ${dialogue ? 'dialogue' : 'prose'} scene at hour ${hour}, ${location.name}`));
  console.log(dim(`  context: ${note}`));
  console.log(dim(`  run "npm run events -- check" when you have written it`));
}

// --- suggest ---------------------------------------------------------------

/**
 * Days where something is already true that a written scene could lean on.
 *
 * Deliberately picks *distinct occasions* rather than every qualifying day:
 * a fortnight of -15°C weather is one thing worth writing about, not fourteen,
 * and a list flooded with near-identical entries is a list nobody reads.
 */
function suggestDays(): void {
  const written = new Set(loadSources().map((d) => d.day));
  const unwritten = (year as unknown as ResolvedDay[]).filter((d) => !written.has(d.day));

  interface Candidate {
    day: number;
    season: string;
    reason: string;
  }
  const picks: Candidate[] = [];
  const taken = new Set<number>();

  const add = (day: ResolvedDay | undefined, reason: string): void => {
    if (!day || taken.has(day.day)) return;
    taken.add(day.day);
    picks.push({ day: day.day, season: day.season, reason });
  };

  // Every marked day in the sky is its own occasion.
  for (const day of unwritten) {
    if (day.cosmicEvent && day.cosmicEvent !== 'None') add(day, day.cosmicEvent);
  }

  const lowOf = (d: ResolvedDay) => Math.min(...d.hourly.map((h) => h.temp));
  const highOf = (d: ResolvedDay) => Math.max(...d.hourly.map((h) => h.temp));
  const wetOf = (d: ResolvedDay) => Math.max(...d.hourly.map((h) => h.precip));
  // Skips days already picked, so an extreme does not vanish just because it
  // happens to fall on a solstice.
  const best = (score: (d: ResolvedDay) => number) =>
    unwritten
      .filter((d) => !taken.has(d.day))
      .reduce<ResolvedDay | undefined>((a, b) => (!a || score(b) > score(a) ? b : a), undefined);

  // 91 days share the year's lowest temperature, so these are phrased as
  // "as cold as it gets" rather than claiming a unique day.
  const coldest = best((d) => -lowOf(d));
  if (coldest) add(coldest, `as cold as the year gets, down to ${lowOf(coldest)}°C`);
  const hottest = best(highOf);
  if (hottest) add(hottest, `as hot as the year gets, up to ${highOf(hottest)}°C`);
  const wettest = best(wetOf);
  if (wettest && wetOf(wettest) > 0) add(wettest, `the heaviest rain of the year (${wetOf(wettest)})`);

  // A key's peak only means something relative to its own year. maintainingHearth
  // sits at 98 every single day, so "at its best" for it says nothing; the
  // interesting days are where a chance is far above where it usually sits.
  const all = year as unknown as ResolvedDay[];
  const yearlyMean = new Map<string, number>();
  for (const key of Object.keys(all[0]?.activitySuccessChance ?? {})) {
    const values = all.map((d) => d.activitySuccessChance[key] ?? 0);
    yearlyMean.set(key, values.reduce((a, b) => a + b, 0) / values.length);
  }

  for (const season of ['Summer', 'Autumn', 'Winter', 'Spring']) {
    const inSeason = unwritten.filter((d) => d.season === season && !taken.has(d.day));

    let peak: { day: ResolvedDay; key: string; value: number; lift: number } | null = null;
    for (const day of inSeason) {
      for (const [key, value] of Object.entries(day.activitySuccessChance)) {
        const lift = value - (yearlyMean.get(key) ?? 0);
        if (value >= 50 && (!peak || lift > peak.lift)) peak = { day, key, value, lift };
      }
    }
    if (peak) {
      const usual = Math.round(yearlyMean.get(peak.key) ?? 0);
      add(peak.day, `${peak.key} at ${peak.value}, against a usual ${usual}`);
    }

    const fullMoon = inSeason.find((d) => d.moonPhase === 'Full Moon' && !taken.has(d.day));
    add(fullMoon, 'full moon — light enough to be out in');
  }

  picks.sort((a, b) => a.day - b.day);

  console.log(`\n${bold('Days worth writing')} ${dim(`(${written.size} of 365 days have any scene)`)}\n`);
  for (const c of picks) {
    console.log(`  ${String(c.day).padStart(3)}  ${c.season.padEnd(7)} ${c.reason}`);
  }
  console.log(`\n${dim('Look at one with:  npm run events -- context <day> <hour> "<place>"')}\n`);
}

// --- check and coverage ----------------------------------------------------

function check(): void {
  try {
    const { cells } = compileEvents(loadSources(), characters, locations);
    console.log(`${cells.length} scene${cells.length === 1 ? '' : 's'} compile cleanly.`);
  } catch (error) {
    if (error instanceof EventCompileError) {
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

function coverage(): void {
  const { cells } = compileEvents(loadSources(), characters, locations);
  const total = 365 * 24 * Object.keys(locations).length;
  const days = new Map<number, number>();
  const places = new Map<string, number>();
  for (const cell of cells) {
    days.set(cell.day, (days.get(cell.day) ?? 0) + 1);
    places.set(cell.location, (places.get(cell.location) ?? 0) + 1);
  }

  console.log(`\n${bold('Authored coverage')}`);
  console.log(`  ${cells.length} of ${total.toLocaleString()} cells (${((cells.length / total) * 100).toFixed(3)}%)`);
  console.log(`  ${days.size} of 365 days, ${places.size} of ${Object.keys(locations).length} places\n`);

  if (days.size > 0) {
    console.log(ochre('  By day'));
    for (const [day, n] of [...days].sort((a, b) => a[0] - b[0])) {
      console.log(`    day ${String(day).padStart(3)}  ${n} scene${n === 1 ? '' : 's'}`);
    }
  }
  const missing = Object.values(locations).filter((l) => !places.has(l.id));
  if (missing.length) {
    console.log(`\n${ochre('  Never written')}`);
    console.log(`    ${missing.map((l) => l.name).join(', ')}`);
  }
  console.log();
}

// --- main ------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case 'context': {
    const [day, hour, ...place] = rest;
    if (!day || !hour || place.length === 0) {
      console.error('Usage: npm run events -- context <day> <hour> "<place>"');
      process.exit(1);
    }
    showContext(Number(day), Number(hour), place.join(' '));
    break;
  }
  case 'new': {
    const dialogue = rest.includes('--dialogue');
    const args = rest.filter((a) => a !== '--dialogue');
    const [day, hour, ...place] = args;
    if (!day || !hour || place.length === 0) {
      console.error('Usage: npm run events -- new <day> <hour> "<place>" [--dialogue]');
      process.exit(1);
    }
    scaffold(Number(day), Number(hour), place.join(' '), dialogue);
    break;
  }
  case 'suggest':
    suggestDays();
    break;
  case 'check':
    check();
    break;
  case 'coverage':
    coverage();
    break;
  default:
    console.log(`
${bold('Authoring scenes')}

  npm run events -- context <day> <hour> "<place>"   what the engine knows about a cell
  npm run events -- new <day> <hour> "<place>"       scaffold an empty scene
  npm run events -- new ... --dialogue               scaffold a dialogue scene
  npm run events -- suggest                          days worth writing
  npm run events -- check                            validate everything
  npm run events -- coverage                         what is written so far

Scenes live in ${dim('data/events/day-NNN.json')} and use real names:
places like ${dim('"The Cave Mouth"')}, speakers like ${dim('"Goizane"')}.
`);
}
