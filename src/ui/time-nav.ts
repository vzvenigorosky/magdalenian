/**
 * Left sidebar: season -> sub-season -> day -> hour. Ported from
 * `magdalenian.html:144-201`, including the rule that a moon icon is shown
 * only on day 1 and on days where the phase changes from the day before.
 */
import type { Season, YearIndex } from '../types.ts';
import { SUB_SEASON_DEFINITIONS, selectedState } from '../state.ts';
import { getMoonIcon } from './moon.ts';

export type TimeChange = 'season' | 'subSeason' | 'day' | 'hour';
export type TimeSelectHandler = (level: TimeChange, value: Season | string | number) => void;

export function renderTimeNav(yearIndex: YearIndex, onSelect: TimeSelectHandler): void {
  const container = document.getElementById('time-nav-container');
  if (!container) return;
  container.innerHTML = '';

  const phaseByDay = new Map(yearIndex.map((d) => [d.day, d.moonPhase]));

  for (const season of Object.keys(SUB_SEASON_DEFINITIONS) as Season[]) {
    const isActiveSeason = selectedState.season === season;

    const seasonEl = document.createElement('div');
    seasonEl.innerHTML = `<h3 class="nav-item font-title text-xl p-2 rounded ${
      isActiveSeason ? 'active' : ''
    }">${season}</h3>`;
    seasonEl.onclick = () => onSelect('season', season);
    container.appendChild(seasonEl);

    if (!isActiveSeason) continue;

    const subSeasonContainer = document.createElement('div');
    subSeasonContainer.className = 'ml-4';

    for (const [subSeason, [start, end]] of Object.entries(SUB_SEASON_DEFINITIONS[season])) {
      const isActiveSub = selectedState.subSeason === subSeason;

      const subSeasonEl = document.createElement('div');
      subSeasonEl.innerHTML = `<h4 class="nav-item p-2 rounded ${
        isActiveSub ? 'active' : ''
      }">${subSeason}</h4>`;
      subSeasonEl.onclick = (e) => {
        e.stopPropagation();
        onSelect('subSeason', subSeason);
      };
      subSeasonContainer.appendChild(subSeasonEl);

      if (!isActiveSub) continue;

      const dayContainer = document.createElement('div');
      dayContainer.className = 'ml-4 grid grid-cols-5 gap-1';

      for (let day = start; day <= end; day++) {
        const phase = phaseByDay.get(day);
        const previousPhase = phaseByDay.get(day - 1);
        const showIcon = phase !== undefined && (day === 1 || phase !== previousPhase);

        const dayEl = document.createElement('div');
        dayEl.className = `nav-item text-center p-1 rounded ${
          selectedState.day === day ? 'active' : ''
        }`;
        dayEl.innerHTML = `${day} ${showIcon && phase ? getMoonIcon(phase) : ''}`;
        dayEl.onclick = (e) => {
          e.stopPropagation();
          onSelect('day', day);
        };
        dayContainer.appendChild(dayEl);
      }
      subSeasonContainer.appendChild(dayContainer);
    }
    container.appendChild(subSeasonContainer);
  }

  const hourContainer = document.createElement('div');
  hourContainer.className = 'mt-4';
  hourContainer.innerHTML = `<h3 class="font-title text-xl p-2">Hour</h3>`;

  const hourGrid = document.createElement('div');
  hourGrid.className = 'grid grid-cols-6 gap-1';
  for (let hour = 0; hour < 24; hour++) {
    const hourEl = document.createElement('div');
    hourEl.className = `nav-item text-center p-1 rounded ${
      selectedState.hour === hour ? 'active' : ''
    }`;
    hourEl.textContent = String(hour);
    hourEl.onclick = (e) => {
      e.stopPropagation();
      onSelect('hour', hour);
    };
    hourGrid.appendChild(hourEl);
  }
  hourContainer.appendChild(hourGrid);
  container.appendChild(hourContainer);
}
