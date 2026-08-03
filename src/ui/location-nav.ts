/** Top bar of location buttons. Ported from `magdalenian.html:203-214`. */
import type { LocationsData } from '../types.ts';
import { selectedState } from '../state.ts';

export function renderLocationNav(
  locations: LocationsData,
  onSelect: (id: string) => void,
): void {
  const container = document.getElementById('location-nav-container');
  if (!container) return;
  container.innerHTML = '';

  for (const [id, location] of Object.entries(locations)) {
    const button = document.createElement('button');
    button.className = `location-button p-2 text-sm rounded ${
      selectedState.locationId === id ? 'active' : ''
    }`;
    button.textContent = location.name;
    button.onclick = () => onSelect(id);
    container.appendChild(button);
  }
}
