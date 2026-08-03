/**
 * Renders a generated scene as prose.
 *
 * Phrasing is drawn from small pools keyed by activity category, picked with
 * the scene's own seeded RNG so the wording is as stable as the scene itself.
 */
import type { ActivityOutcome, GeneratedScene, Incident } from './engine.ts';
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

function narrateActivity(outcome: ActivityOutcome, rng: Rng): string {
  const who = joinNames(outcome.actors);
  const what = escapeHtml(outcome.label);
  const category = categoryOf(outcome);

  const opening = `${who} ${outcome.actors.length === 1 ? 'is' : 'are'} ${what}.`;
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

export function narrateScene(scene: GeneratedScene, seed: string): string {
  const rng = createRng(hashSeed('narrate', seed));

  const parts: string[] = [
    `<p class="text-lg leading-relaxed italic text-gray-400 mb-4">${escapeHtml(scene.ambience)}</p>`,
  ];

  if (scene.activities.length > 0) {
    const lines = scene.activities.map((a) => `<p class="mb-3">${narrateActivity(a, rng)}</p>`);
    parts.push(`<div class="text-lg leading-relaxed">${lines.join('')}</div>`);
  }

  if (scene.incidents.length > 0) {
    const lines = scene.incidents.map((i) => `<p class="mb-2">${narrateIncident(i)}</p>`);
    parts.push(`<div class="text-lg leading-relaxed mt-4 pt-4 border-t border-gray-700">${lines.join('')}</div>`);
  }

  return parts.join('');
}
