/**
 * The authoring format and its compiler.
 *
 * The point of the format is that a writer never types `char35` or `loc22`, so
 * these tests care most about name resolution and about error messages being
 * good enough to act on.
 */
import { describe, expect, it } from 'vitest';
import {
  EventCompileError,
  compileEvents,
  type SourceDay,
} from '../src/data/events-source.ts';
import { characters, eventSources, locations } from './helpers.ts';

const compile = (days: SourceDay[]) => compileEvents(days, characters, locations);

const problemsOf = (days: SourceDay[]): string[] => {
  try {
    compile(days);
    return [];
  } catch (error) {
    if (error instanceof EventCompileError) return error.problems;
    throw error;
  }
};

describe('compiling authored scenes', () => {
  it('resolves place and speaker names to ids', () => {
    const { events } = compile([
      {
        day: 5,
        scenes: [
          { hour: 9, at: 'The Cave Mouth', text: 'Smoke, and the smell of it.' },
          {
            hour: 10,
            at: 'The Flint Quarry',
            narration: 'Chips of flint underfoot.',
            dialogue: [{ speaker: 'Zahar', line: 'Hold it to the light first.' }],
          },
        ],
      },
    ]);

    expect(events.schedule[0]).toEqual({
      day: 5,
      hour: 9,
      location: 'loc0',
      type: 'event',
      content: 'Smoke, and the smell of it.',
    });

    const dialogue = events.schedule[1]!;
    expect(dialogue.location).toBe('loc10');
    expect(dialogue.type).toBe('dialogue');
    if (dialogue.type === 'dialogue') {
      expect(dialogue.content.dialogue[0]!.speakerId).toBe('char0'); // Zahar
    }
  });

  it('ignores _note fields, which exist only for the writer', () => {
    const { events } = compile([
      {
        day: 5,
        _note: 'a reminder to myself',
        scenes: [{ hour: 9, at: 'The Cave Mouth', text: 'Smoke.', _note: 'cold day' }],
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('_note');
    expect(JSON.stringify(events)).not.toContain('reminder');
  });

  it('trims whitespace from prose and lines', () => {
    const { events } = compile([
      { day: 5, scenes: [{ hour: 9, at: 'The Cave Mouth', text: '  padded  ' }] },
    ]);
    expect((events.schedule[0] as { content: string }).content).toBe('padded');
  });

  it('sorts output so the generated file does not churn', () => {
    const { events } = compile([
      {
        day: 9,
        scenes: [
          { hour: 20, at: 'The Cave Mouth', text: 'late' },
          { hour: 2, at: 'The Cave Mouth', text: 'early' },
        ],
      },
      { day: 3, scenes: [{ hour: 5, at: 'The Cave Mouth', text: 'earlier day' }] },
    ]);
    expect(events.schedule.map((e) => [e.day, e.hour])).toEqual([
      [3, 5],
      [9, 2],
      [9, 20],
    ]);
  });

  it('reports the authored cells for coverage', () => {
    const { cells } = compile([
      { day: 5, scenes: [{ hour: 9, at: 'The Cave Mouth', text: 'x' }] },
    ]);
    expect(cells).toEqual([{ day: 5, hour: 9, location: 'loc0' }]);
  });

  it('accepts an empty set of days', () => {
    expect(compile([]).events.schedule).toEqual([]);
  });
});

describe('validation', () => {
  it('collects every problem rather than stopping at the first', () => {
    const problems = problemsOf([
      {
        day: 5,
        scenes: [
          { hour: 99, at: 'The Cave Mouth', text: 'x' },
          { hour: 1, at: 'Nowhere At All', text: 'x' },
          { hour: 2, at: 'The Cave Mouth' },
        ],
      },
    ]);
    expect(problems).toHaveLength(3);
  });

  it('suggests the right name for a misspelled place', () => {
    const [problem] = problemsOf([
      { day: 5, scenes: [{ hour: 1, at: 'The Pained Cave', text: 'x' }] },
    ]);
    expect(problem).toContain('did you mean "The Painted Cave"');
  });

  it('suggests the right name for a misspelled speaker', () => {
    const [problem] = problemsOf([
      {
        day: 5,
        scenes: [
          { hour: 1, at: 'The Cave Mouth', narration: 'n', dialogue: [{ speaker: 'Gozane', line: 'x' }] },
        ],
      },
    ]);
    expect(problem).toContain('did you mean "Goizane"');
  });

  it('does not invent a suggestion for something wildly wrong', () => {
    const [problem] = problemsOf([
      { day: 5, scenes: [{ hour: 1, at: 'Vladivostok', text: 'x' }] },
    ]);
    expect(problem).not.toContain('did you mean');
  });

  it('catches two scenes claiming the same cell', () => {
    const problems = problemsOf([
      {
        day: 5,
        scenes: [
          { hour: 3, at: 'The Cave Mouth', text: 'a' },
          { hour: 3, at: 'The Cave Mouth', text: 'b' },
        ],
      },
    ]);
    expect(problems[0]).toMatch(/already written/);
  });

  it('rejects a scene that is both prose and dialogue', () => {
    const problems = problemsOf([
      {
        day: 5,
        scenes: [
          { hour: 3, at: 'The Cave Mouth', text: 'a', dialogue: [{ speaker: 'Zahar', line: 'b' }] },
        ],
      },
    ]);
    expect(problems[0]).toMatch(/one or the other/);
  });

  it('rejects an empty scene, a silent speaker and a missing narration together', () => {
    const problems = problemsOf([
      {
        day: 5,
        scenes: [
          { hour: 1, at: 'The Cave Mouth' },
          { hour: 2, at: 'The Cave Mouth', narration: '', dialogue: [{ speaker: 'Zahar', line: '  ' }] },
        ],
      },
    ]);
    expect(problems.join('\n')).toMatch(/needs either "text"/);
    expect(problems.join('\n')).toMatch(/need a "narration"/);
    expect(problems.join('\n')).toMatch(/Zahar has nothing to say/);
  });

  it('rejects days and hours outside the world', () => {
    expect(problemsOf([{ day: 0, scenes: [] }])[0]).toMatch(/1 to 365/);
    expect(problemsOf([{ day: 366, scenes: [] }])[0]).toMatch(/1 to 365/);
    expect(
      problemsOf([{ day: 5, scenes: [{ hour: -1, at: 'The Cave Mouth', text: 'x' }] }])[0],
    ).toMatch(/0 to 23/);
  });
});

describe('the checked-in scenes', () => {
  it('compile cleanly', () => {
    expect(() => compile(eventSources)).not.toThrow();
  });

  it('still describe day 1 in full — 24 hours at the cave mouth and beyond', () => {
    const { events, cells } = compile(eventSources);
    expect(cells).toHaveLength(24);
    expect(new Set(cells.map((c) => c.day))).toEqual(new Set([1]));
    expect(new Set(events.schedule.map((e) => e.hour)).size).toBe(24);
  });

  it('name only real places and speakers', () => {
    const { events } = compile(eventSources);
    for (const event of events.schedule) {
      expect(locations[event.location], event.location).toBeDefined();
      if (event.type !== 'dialogue') continue;
      for (const line of event.content.dialogue) {
        expect(characters[line.speakerId], line.speakerId).toBeDefined();
      }
    }
  });

  it('carry a day number matching their filename', () => {
    for (const source of eventSources) {
      expect(Number.isInteger(source.day)).toBe(true);
      for (const scene of source.scenes) {
        expect(scene.hour, `day ${source.day}`).toBeGreaterThanOrEqual(0);
        expect(scene.hour, `day ${source.day}`).toBeLessThan(24);
      }
    }
  });
});
