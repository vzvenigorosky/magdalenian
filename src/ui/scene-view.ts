/**
 * Centre panel. Renders the day header, the location, the hour's conditions,
 * and then either the authored event for this cell or a generated scene.
 *
 * The authored-event markup is kept identical to `magdalenian.html:262-273` so
 * existing hand-written content renders exactly as it always has.
 */
import type { AuthoredEvent, CharactersData, HourlyWeather, Location, ResolvedDay } from '../types.ts';
import type { Scene } from '../sim/engine.ts';
import { narrateScene } from '../sim/narrate.ts';
import { getMoonIcon } from './moon.ts';

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

function renderAuthored(event: AuthoredEvent, characters: CharactersData): string {
  if (event.type === 'event') {
    return `<div class="text-lg leading-relaxed">${event.content}</div>`;
  }

  const lines = event.content.dialogue
    .map((line) => {
      const speaker = characters[line.speakerId]?.name ?? 'Unknown';
      return `<p class="mb-2"><span class="character-name" data-char-id="${line.speakerId}">${speaker}:</span> "${line.line}"</p>`;
    })
    .join('');

  return `<div class="text-lg leading-relaxed">
      <p class="italic text-gray-400 mb-4">${event.content.narration}</p>
      ${lines}
    </div>`;
}

function renderConditions(weather: HourlyWeather | undefined, day: ResolvedDay): string {
  if (!weather) return '';
  const bits = [
    `${weather.temp}&deg;C`,
    weather.sunExposure,
    weather.precip > 0 ? `rain ${weather.precip}` : null,
    `humidity ${weather.humidity}%`,
    escapeHtml(day.wind),
  ].filter(Boolean);
  return `<p class="text-sm text-gray-500 mt-1">${bits.join(' &middot; ')}</p>`;
}

export interface SceneViewInput {
  day: ResolvedDay;
  hour: number;
  location: Location;
  scene: Scene;
  characters: CharactersData;
}

export function renderScene(input: SceneViewInput): void {
  const container = document.getElementById('main-display');
  if (!container) return;

  const { day, hour, location, scene, characters } = input;
  const weather = day.hourly.find((h) => h.hour === hour);

  const cosmic =
    day.cosmicEvent && day.cosmicEvent !== 'None'
      ? `<p class="text-sm text-[#c7a78a] mt-1">${escapeHtml(day.cosmicEvent)}</p>`
      : '';

  const header = `
    <div class="border-b border-gray-700 pb-4 mb-4">
      <h2 class="font-title text-3xl text-[#c7a78a] flex items-center gap-2">
        Day ${day.day} ${getMoonIcon(day.moonPhase)}
      </h2>
      <p class="text-lg text-amber-300">${escapeHtml(day.season)} &mdash; ${escapeHtml(day.relativeEvent)}</p>
      <p class="italic text-gray-400 mt-2">"${escapeHtml(day.poeticComment)}"</p>
      ${cosmic}
    </div>`;

  const place = `
    <div class="border-b border-gray-600 pb-4 mb-4">
      <h3 class="font-title text-2xl text-[#c7a78a]">${escapeHtml(location.name)}</h3>
      <p class="italic text-gray-400">${escapeHtml(location.description)}</p>
      <p class="text-sm text-gray-500 mt-1">
        ${location.distanceFromCenter.meters} m from the cave &middot;
        ${location.distanceFromCenter.adultWalkMinutes} min walk &middot;
        hour ${hour}
      </p>
      ${renderConditions(weather, day)}
    </div>`;

  const body =
    scene.kind === 'authored'
      ? renderAuthored(scene.event, characters)
      : narrateScene(scene, `${day.day}:${hour}:${location.id}`);

  container.innerHTML = header + place + body;
  container.scrollTop = 0;
}

export function renderMessage(html: string): void {
  const container = document.getElementById('main-display');
  if (container) container.innerHTML = html;
}

export function displayError(message = 'The data files are missing or corrupted.'): void {
  document.body.innerHTML = `<div class="h-screen flex items-center justify-center text-center">
      <div>
        <h1 class="font-title text-4xl text-red-500">The Threads of Time are Tangled</h1>
        <p class="text-xl text-gray-400 mt-4">The spirits are restless, and the world cannot be seen clearly. ${escapeHtml(message)}</p>
      </div>
    </div>`;
}
