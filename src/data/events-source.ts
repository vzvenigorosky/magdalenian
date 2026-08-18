/**
 * The authoring format for hand-written scenes, and its compiler.
 *
 * The runtime schedule refers to `char35` and `loc22`, which is fine for code
 * and hopeless for writing: nobody should have to keep a lookup table open to
 * put words in Goizane's mouth. Scenes are therefore authored per day, in
 * `data/events/day-NNN.json`, using the names that appear in the app, and
 * compiled to the runtime shape at build time.
 *
 * Anything keyed `_note` is ignored by the compiler, so context and reminders
 * can sit beside the prose in a format that has no comments.
 */
import type { AuthoredEvent, CharactersData, EventsData, LocationsData } from '../types.ts';

export interface SourceDialogueLine {
  speaker: string;
  line: string;
}

/** A scene is prose (`text`) or dialogue (`narration` + `dialogue`). */
export interface SourceScene {
  hour: number;
  /** Location *name*, e.g. "The Whispering Valley". */
  at: string;
  text?: string;
  narration?: string;
  dialogue?: SourceDialogueLine[];
  _note?: unknown;
}

export interface SourceDay {
  day: number;
  scenes: SourceScene[];
  _note?: unknown;
}

export class EventCompileError extends Error {
  constructor(readonly problems: string[]) {
    super(`${problems.length} problem${problems.length === 1 ? '' : 's'} in authored events:\n  ${problems.join('\n  ')}`);
    this.name = 'EventCompileError';
  }
}

/** Levenshtein, used only to say "did you mean" on a misspelled name. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
    }
  }
  return rows[a.length]![b.length]!;
}

function nearest(needle: string, haystack: string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const candidate of haystack) {
    const score = distance(needle.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  // Only suggest something genuinely close, or the hint is noise.
  return best !== null && bestScore <= Math.max(3, needle.length / 2) ? best : null;
}

const suggest = (name: string, options: string[]): string => {
  const hint = nearest(name, options);
  return hint ? ` — did you mean "${hint}"?` : '';
};

export interface CompileResult {
  events: EventsData;
  /** One entry per authored cell, for coverage reporting. */
  cells: Array<{ day: number; hour: number; location: string }>;
}

/**
 * Turns authored source into the runtime schedule.
 *
 * Collects *every* problem before throwing rather than failing on the first,
 * so a writer fixing a batch of scenes sees the whole list at once.
 */
export function compileEvents(
  days: SourceDay[],
  characters: CharactersData,
  locations: LocationsData,
): CompileResult {
  const problems: string[] = [];

  const locationByName = new Map<string, string>();
  for (const [id, location] of Object.entries(locations)) locationByName.set(location.name, id);
  const locationNames = [...locationByName.keys()];

  const characterByName = new Map<string, string>();
  for (const [id, character] of Object.entries(characters)) characterByName.set(character.name, id);
  const characterNames = [...characterByName.keys()];

  const schedule: AuthoredEvent[] = [];
  const cells: CompileResult['cells'] = [];
  const seen = new Map<string, string>();

  for (const source of days) {
    const where = `day ${source.day}`;

    if (!Number.isInteger(source.day) || source.day < 1 || source.day > 365) {
      problems.push(`${where}: day must be a whole number from 1 to 365`);
      continue;
    }
    if (!Array.isArray(source.scenes)) {
      problems.push(`${where}: "scenes" must be a list`);
      continue;
    }

    for (const [index, scene] of source.scenes.entries()) {
      const at = `${where}, scene ${index + 1}`;

      if (!Number.isInteger(scene.hour) || scene.hour < 0 || scene.hour > 23) {
        problems.push(`${at}: hour must be a whole number from 0 to 23 (got ${JSON.stringify(scene.hour)})`);
        continue;
      }

      const locationId = locationByName.get(scene.at);
      if (!locationId) {
        problems.push(`${at} (hour ${scene.hour}): unknown place "${scene.at}"${suggest(scene.at, locationNames)}`);
        continue;
      }

      const key = `${source.day}:${scene.hour}:${locationId}`;
      const previous = seen.get(key);
      if (previous) {
        problems.push(`${at}: ${scene.at} at hour ${scene.hour} is already written in ${previous}`);
        continue;
      }
      seen.set(key, at);

      const hasProse = typeof scene.text === 'string' && scene.text.trim().length > 0;
      const hasDialogue = Array.isArray(scene.dialogue) && scene.dialogue.length > 0;

      if (hasProse && hasDialogue) {
        problems.push(`${at}: has both "text" and "dialogue" — a scene is one or the other`);
        continue;
      }
      if (!hasProse && !hasDialogue) {
        problems.push(`${at}: needs either "text", or "narration" with "dialogue"`);
        continue;
      }

      if (hasProse) {
        schedule.push({
          day: source.day,
          hour: scene.hour,
          location: locationId,
          type: 'event',
          content: scene.text!.trim(),
        });
        cells.push({ day: source.day, hour: scene.hour, location: locationId });
        continue;
      }

      const narration = typeof scene.narration === 'string' ? scene.narration.trim() : '';
      // Recorded, but the lines are still checked, so one run reports everything
      // wrong with the scene rather than one thing at a time.
      let lineProblem = !narration;
      if (!narration) problems.push(`${at}: dialogue scenes need a "narration" line to set them up`);

      const lines: Array<{ speakerId: string; line: string }> = [];
      for (const [lineIndex, entry] of scene.dialogue!.entries()) {
        const speakerId = characterByName.get(entry.speaker);
        if (!speakerId) {
          problems.push(
            `${at}, line ${lineIndex + 1}: unknown speaker "${entry.speaker}"${suggest(entry.speaker, characterNames)}`,
          );
          lineProblem = true;
          continue;
        }
        if (typeof entry.line !== 'string' || entry.line.trim().length === 0) {
          problems.push(`${at}, line ${lineIndex + 1}: ${entry.speaker} has nothing to say`);
          lineProblem = true;
          continue;
        }
        lines.push({ speakerId, line: entry.line.trim() });
      }
      if (lineProblem) continue;

      schedule.push({
        day: source.day,
        hour: scene.hour,
        location: locationId,
        type: 'dialogue',
        content: { narration, dialogue: lines },
      });
      cells.push({ day: source.day, hour: scene.hour, location: locationId });
    }
  }

  if (problems.length > 0) throw new EventCompileError(problems);

  // Stable order, so the generated file does not churn between builds.
  schedule.sort((a, b) => a.day - b.day || a.hour - b.hour || a.location.localeCompare(b.location));
  return { events: { schedule }, cells };
}
