import './styles.css';

import type { Season } from './types.ts';
import { loadCore, resolveDay, type CoreData } from './data/loader.ts';
import { findAmbience, generateScene } from './sim/engine.ts';
import { SUB_SEASON_DEFINITIONS, selectedState, subSeasonForDay } from './state.ts';
import { renderLocationNav } from './ui/location-nav.ts';
import { displayError, renderMessage, renderScene } from './ui/scene-view.ts';
import { renderTimeNav, type TimeChange } from './ui/time-nav.ts';
import { initTooltip, pickCharacterDescriptions } from './ui/tooltip.ts';
import { renderCharacterIndex } from './ui/character-index.ts';
import { initKeyboard } from './ui/keyboard.ts';
import {
  applyPosition,
  currentPosition,
  onNavigate,
  parseHash,
  writeHash,
} from './ui/router.ts';

let core: CoreData;
let indexOpen = false;

/**
 * Guards against a slow season chunk landing after the user has already moved
 * on: only the most recent request is allowed to paint.
 */
let renderToken = 0;

async function updateMainDisplay(): Promise<void> {
  const token = ++renderToken;
  const { day: dayNumber, hour, locationId } = selectedState;

  const location = core.locations[locationId];
  if (!location) {
    renderMessage(
      `<p class="text-center text-gray-500 text-2xl italic mt-10">That place is not on any map.</p>`,
    );
    return;
  }

  let day;
  try {
    day = await resolveDay(core.yearIndex, dayNumber);
  } catch {
    if (token === renderToken) {
      renderMessage(
        `<p class="text-center text-red-500 text-2xl italic mt-10">The spirits cannot reach this day. Try again.</p>`,
      );
    }
    return;
  }
  if (token !== renderToken) return;

  if (!day) {
    renderMessage(
      `<p class="text-center text-red-500 text-2xl italic mt-10">The spirits cannot find this day in their memory.</p>`,
    );
    return;
  }

  const scene = generateScene({
    day,
    hour,
    location,
    profiles: core.profiles,
    relationships: core.relationships,
    authored: core.events.schedule,
    ambience: findAmbience(core.defaultEvents, day.season, hour, location.type),
  });

  renderScene({ day, hour, location, scene, characters: core.characters });
}

/** Renders whichever view is active, and keeps the URL in step. */
function refresh(options: { replaceHistory?: boolean } = {}): void {
  writeHash(currentPosition(), options.replaceHistory ?? false);
  renderTimeNav(core.yearIndex, onTimeSelect);
  renderLocationNav(core.locations, onLocationSelect);
  if (indexOpen) {
    renderMessage(renderCharacterIndex(core.characters, core.profiles, core.relationships));
    document.getElementById('close-index')?.addEventListener('click', () => toggleIndex());
    return;
  }
  void updateMainDisplay();
}

function toggleIndex(force?: boolean): void {
  const next = force ?? !indexOpen;
  if (next === indexOpen) return;
  indexOpen = next;
  refresh({ replaceHistory: true });
}

const clampDay = (day: number) => Math.min(365, Math.max(1, day));

/** Stepping past midnight rolls into the neighbouring day, as time does. */
function stepHour(delta: number): void {
  const total = selectedState.day * 24 + selectedState.hour + delta;
  const day = clampDay(Math.floor(total / 24));
  applyPosition({ day, hour: ((total % 24) + 24) % 24, locationId: selectedState.locationId });
  toggleIndex(false);
  refresh();
}

function stepDay(delta: number): void {
  applyPosition({
    day: clampDay(selectedState.day + delta),
    hour: selectedState.hour,
    locationId: selectedState.locationId,
  });
  toggleIndex(false);
  refresh();
}

function stepLocation(delta: number): void {
  const ids = Object.keys(core.locations);
  const at = ids.indexOf(selectedState.locationId);
  const next = ids[(at + delta + ids.length) % ids.length];
  if (next) selectedState.locationId = next;
  toggleIndex(false);
  refresh();
}

function onTimeSelect(level: TimeChange, value: Season | string | number): void {
  if (level === 'season') {
    const season = value as Season;
    selectedState.season = season;
    const first = Object.keys(SUB_SEASON_DEFINITIONS[season])[0]!;
    selectedState.subSeason = first;
    selectedState.day = SUB_SEASON_DEFINITIONS[season][first]![0];
  } else if (level === 'subSeason') {
    const subSeason = value as string;
    selectedState.subSeason = subSeason;
    selectedState.day = SUB_SEASON_DEFINITIONS[selectedState.season][subSeason]![0];
  } else if (level === 'day') {
    selectedState.day = value as number;
    selectedState.subSeason = subSeasonForDay(selectedState.season, selectedState.day);
  } else {
    selectedState.hour = value as number;
  }

  toggleIndex(false);
  refresh();
}

function onLocationSelect(id: string): void {
  selectedState.locationId = id;
  toggleIndex(false);
  refresh();
}

async function main(): Promise<void> {
  try {
    core = await loadCore();
  } catch (error) {
    console.error('Failed to load simulation data:', error);
    displayError(error instanceof Error ? error.message : undefined);
    return;
  }

  document.getElementById('simulation-container')?.classList.remove('hidden');

  pickCharacterDescriptions(core.characters);
  initTooltip(core.characters);

  // A shared or bookmarked URL wins over the default opening view.
  const fromUrl = parseHash(window.location.hash, (id) => id in core.locations);
  if (fromUrl) applyPosition(fromUrl);

  onNavigate(() => {
    const position = parseHash(window.location.hash, (id) => id in core.locations);
    if (!position) return;
    applyPosition(position);
    indexOpen = false;
    renderTimeNav(core.yearIndex, onTimeSelect);
    renderLocationNav(core.locations, onLocationSelect);
    void updateMainDisplay();
  });

  initKeyboard({ stepHour, stepDay, stepLocation, toggleIndex: () => toggleIndex() });
  document.getElementById('open-index')?.addEventListener('click', () => toggleIndex());

  refresh({ replaceHistory: true });
}

void main();
