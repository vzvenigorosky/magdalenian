/**
 * Renders a generated scene as prose.
 *
 * Phrasing is drawn from small pools keyed by activity category, picked with
 * the scene's own seeded RNG so the wording is as stable as the scene itself.
 */
import type { ActivityOutcome, GeneratedScene, Incident, SceneConditions } from './engine.ts';
import { assertsEmpty } from './ambience.ts';
import { createRng, hashSeed, type Rng } from './rng.ts';

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

/** Character names render as tooltip-bearing spans, as in the authored dialogue. */
function nameSpan(id: string, name: string): string {
  return `<span class="character-name" data-char-id="${escapeHtml(id)}">${escapeHtml(name)}</span>`;
}

function joinNames(actors: ActivityOutcome['actors']): string {
  const spans = actors.map((a) => nameSpan(a.id, a.name));
  if (spans.length === 0) return 'Someone';
  if (spans.length === 1) return spans[0]!;
  return `${spans.slice(0, -1).join(', ')} and ${spans.at(-1)!}`;
}

/**
 * Only `quarry` and `craft` are attempts that can visibly fail. Rest and
 * social acts carry a success chance in the data (`childcare` is 95,
 * `restingEffectively` 80) but narrating them as pass/fail produces nonsense
 * like "sleeping deeply. Steady hands, and it holds." — so they get
 * outcome-neutral phrasing instead.
 */
type Category = 'quarry' | 'craft' | 'rest' | 'social';

const REST_ACTIVITIES = new Set([
  'restingEffectively',
  'napping',
  'deepSleep',
  'meditatingOrTrance',
]);

const CRAFT_PREFIXES =
  /^(knapping|carving|crafting|sewing|weaving|making|preparing|smoking|butchering|cavePainting|engraving|building|digging)/;
const QUARRY_PREFIXES = /^(hunting|trapping|fishing|foraging|gathering|findingDryFirewood)/;

function categoryOf(outcome: ActivityOutcome): Category {
  if (REST_ACTIVITIES.has(outcome.activity)) return 'rest';
  if (QUARRY_PREFIXES.test(outcome.activity)) return 'quarry';
  if (CRAFT_PREFIXES.test(outcome.activity)) return 'craft';
  return 'social';
}

const SUCCESS_PHRASES: Record<'quarry' | 'craft', string[]> = {
  quarry: [
    'They come back with enough.',
    'The effort pays; there is something to carry home.',
    'It goes well — the band will eat better tonight.',
  ],
  craft: [
    'The work goes well.',
    'It comes out better than expected.',
    'Steady hands, and it holds.',
  ],
};

const FAILURE_PHRASES: Record<'quarry' | 'craft', string[]> = {
  quarry: [
    'They return with nothing.',
    'Hours pass and there is nothing to show for it.',
    'The quarry does not come.',
  ],
  craft: [
    'The work is spoiled and must be started again.',
    'It cracks, and the morning is wasted.',
    'Nothing usable comes of it.',
  ],
};

/**
 * Outcome-neutral closers, so quiet scenes still have some texture. Kept free
 * of place detail — these are used at every location, from the cave to a
 * berry thicket.
 */
const REST_PHRASES = ['Nothing stirs them.', 'The hours pass slowly.', 'No one hurries them.'];


/** [singular, plural] — one teacher takes "shows", several take "show". */
const TEACHING_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['is teaching', 'are teaching'],
  ['shows the way of it to', 'show the way of it to'],
  ['passes the knack on to', 'pass the knack on to'],
];

/** [singular, plural] — one minder takes "keeps", several take "keep". */
const MINDING_PHRASES: ReadonlyArray<readonly [string, string]> = [
  ['keeps an eye on', 'keep an eye on'],
  ['watches over', 'watch over'],
  ['stays close to', 'stay close to'],
];

/**
 * Clauses drawn from the hour's conditions, so the same activity reads
 * differently in a downpour and in flat noon sun. Each is [test, phrasings];
 * the first matching entry wins, and only one is ever used, because two
 * stacked qualifiers read as padding rather than atmosphere.
 */
const CONDITION_CLAUSES: ReadonlyArray<
  readonly [(c: SceneConditions) => boolean, readonly string[]]
> = [
  [
    (c) => c.precip > 5,
    ['Through driving rain', 'In rain that has not let up all day', 'Soaked through'],
  ],
  [(c) => c.precip > 0, ['In the wet', 'Through a thin drizzle']],
  [
    (c) => c.temp <= -8,
    ['In cold that stops the breath', 'On ground frozen iron-hard', 'In a cold that cracks stone'],
  ],
  [(c) => c.temp <= 0, ['In the frost', 'With cold stiffening the fingers', 'On frozen ground']],
  [
    (c) => c.sunExposure === 'Dark' && c.moonlight >= 0.7,
    ['By a moon bright enough to work by', 'In full moonlight', 'Under a high white moon'],
  ],
  [
    (c) => c.sunExposure === 'Dark',
    ['In the dark', 'By feel more than sight', 'By firelight'],
  ],
  [(c) => c.sunExposure === 'Low', ['In the last of the light', 'In low, slanting light']],
  [(c) => c.sunExposure === 'Overcast', ['Under a flat grey sky', 'In dull light']],
  [(c) => c.temp >= 26, ['In the full heat of the day', 'In heat that slows everything']],
  [(c) => c.tide === 'low', ['With the water far out', 'On the wide uncovered shore']],
  [(c) => c.tide === 'high', ['With the water right up the shingle']],
  [(c) => /gust|strong|biting|sharp/i.test(c.wind), ['In a wind that snatches at everything']],
];

function conditionClause(conditions: SceneConditions, rng: Rng): string | null {
  for (const [test, phrasings] of CONDITION_CLAUSES) {
    if (test(conditions)) return rng.pick(phrasings) ?? null;
  }
  return null;
}

function narrateActivity(outcome: ActivityOutcome, conditions: SceneConditions, rng: Rng): string {
  const who = joinNames(outcome.actors);
  const what = escapeHtml(outcome.label);
  const category = categoryOf(outcome);

  // Naming the children makes the scene add up — you can see who is being
  // minded or taught and by how many, rather than "minding the children" in
  // the abstract.
  if (outcome.charges && outcome.charges.length > 0) {
    const pool = outcome.activity === 'teachingChild' ? TEACHING_PHRASES : MINDING_PHRASES;
    const phrase = rng.pick(pool) ?? pool[0]!;
    const verb = outcome.actors.length === 1 ? phrase[0] : phrase[1];
    return `${who} ${verb} ${joinNames(outcome.charges)}.`;
  }

  // Only some lines take a condition clause; on every line it becomes a tic.
  const clause = rng.chance(45) ? conditionClause(conditions, rng) : null;
  const subject = `${who} ${outcome.actors.length === 1 ? 'is' : 'are'} ${what}`;
  const opening = clause ? `${clause}, ${subject}.` : `${subject}.`;

  if (category === 'social') return opening;
  if (category === 'rest') return `${opening} ${rng.pick(REST_PHRASES) ?? ''}`.trim();

  const pool = outcome.succeeded ? SUCCESS_PHRASES[category] : FAILURE_PHRASES[category];
  return `${opening} ${rng.pick(pool) ?? ''}`.trim();
}

function narrateIncident(incident: Incident): string {
  const label = escapeHtml(incident.label);
  return incident.grave
    ? `<span class="text-red-400">Then — ${label}. The day breaks in two.</span>`
    : `<span class="text-amber-300">There is ${label}.</span>`;
}

/** A line for the thirteen days of the year that carry a cosmic event. */
function cosmicNote(event: string, isNight: boolean): string {
  if (/meteor/i.test(event)) {
    return isNight
      ? `Overhead, ${event.replace(/\s*\(Peak\)/, '')} — the sky is throwing down streaks of fire.`
      : `Tonight the sky will burn: ${event.replace(/\s*\(Peak\)/, '')}.`;
  }
  if (/comet/i.test(event)) {
    return isNight
      ? 'The hairy star hangs where it has hung for nights now, and no one likes it.'
      : 'The hairy star will be there again after dark. It has been much discussed.';
  }
  if (/solstice/i.test(event)) {
    return /summer/i.test(event)
      ? 'The longest day. From here the light begins to go.'
      : 'The shortest day. From here the light begins to come back.';
  }
  if (/equinox/i.test(event)) return 'Day and night stand equal. The year has turned.';
  if (/conjunction|alignment/i.test(event)) {
    return 'Two bright stars stand close together, near enough to touch.';
  }
  return event;
}

export function narrateScene(scene: GeneratedScene, seed: string): string {
  const rng = createRng(hashSeed('narrate', seed));

  const parts: string[] = [];

  // Keep the line when the place really is empty; drop it only when the scene
  // is about to contradict it by naming people at work.
  const contradicted = scene.activities.length > 0 && assertsEmpty(scene.ambience);
  if (!contradicted) {
    parts.push(
      `<p class="text-lg leading-relaxed italic text-gray-400 mb-4">${escapeHtml(scene.ambience.text)}</p>`,
    );
  }

  if (scene.activities.length > 0) {
    const lines = scene.activities.map(
      (a) => `<p class="mb-3">${narrateActivity(a, scene.conditions, rng)}</p>`,
    );
    parts.push(`<div class="text-lg leading-relaxed">${lines.join('')}</div>`);
  }

  // The thirteen marked days should feel marked.
  if (scene.conditions.cosmicEvent && scene.conditions.cosmicEvent !== 'None') {
    parts.push(
      `<p class="text-lg leading-relaxed italic text-[#c7a78a] mt-4">${escapeHtml(
        cosmicNote(scene.conditions.cosmicEvent, scene.conditions.sunExposure === 'Dark'),
      )}</p>`,
    );
  }

  if (scene.incidents.length > 0) {
    const lines = scene.incidents.map((i) => `<p class="mb-2">${narrateIncident(i)}</p>`);
    parts.push(`<div class="text-lg leading-relaxed mt-4 pt-4 border-t border-gray-700">${lines.join('')}</div>`);
  }

  return parts.join('');
}
