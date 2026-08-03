import type { MoonPhase } from '../types.ts';

/** Inline SVG paths, carried over verbatim from `magdalenian.html:332-344`. */
const MOON_ICONS: Record<MoonPhase, string> = {
  'New Moon': `<circle cx="12" cy="12" r="8" fill="black" stroke="white" stroke-width="1.5"/>`,
  'Waxing Crescent': `<path d="M12 4 a 8 8 0 0 1 0 16 a 4 4 0 0 0 0 -16" fill="white"/>`,
  'First Quarter': `<path d="M12 4 a 8 8 0 0 1 0 16 V 4" fill="white"/>`,
  'Waxing Gibbous': `<path d="M12 4 a 8 8 0 0 1 0 16 a 4 4 0 0 1 0 -16" fill="white"/>`,
  'Full Moon': `<circle cx="12" cy="12" r="8" fill="white"/>`,
  'Waning Gibbous': `<path d="M12 4 a 8 8 0 0 0 0 16 a 4 4 0 0 0 0 -16" fill="white"/>`,
  'Last Quarter': `<path d="M12 4 a 8 8 0 0 0 0 16 V 4" fill="white"/>`,
  'Waning Crescent': `<path d="M12 4 a 8 8 0 0 0 0 16 a 4 4 0 0 1 0 -16" fill="white"/>`,
};

export function getMoonIcon(moonPhase: MoonPhase): string {
  return `<svg class="moon-icon" viewBox="0 0 24 24">${MOON_ICONS[moonPhase] ?? ''}</svg>`;
}
