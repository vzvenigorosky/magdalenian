/**
 * Hover tooltips on character names. Ported from `magdalenian.html:121-140`.
 *
 * Each character keeps one randomly-chosen description for the whole page
 * load, matching the original behaviour (`magdalenian.html:112-115`).
 */
import type { CharactersData } from '../types.ts';

const randomizedDescriptions: Record<string, string> = {};

export function pickCharacterDescriptions(characters: CharactersData): void {
  for (const [id, character] of Object.entries(characters)) {
    const index = Math.floor(Math.random() * 10);
    randomizedDescriptions[id] = character[`description${index}`] ?? character.description0 ?? '';
  }
}

export function describeCharacter(id: string): string {
  return randomizedDescriptions[id] ?? '';
}

export function initTooltip(characters: CharactersData): void {
  const tooltip = document.getElementById('tooltip');
  if (!tooltip) return;

  document.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.classList.contains('character-name')) return;

    const charId = target.dataset.charId;
    const character = charId ? characters[charId] : undefined;
    const description = charId ? randomizedDescriptions[charId] : undefined;
    if (!character || !description) return;

    tooltip.innerHTML = `<h3 class="font-title text-lg text-[#c7a78a]">${character.name}</h3><p class="text-sm text-gray-400">${description}</p>`;
    tooltip.style.display = 'block';
  });

  document.addEventListener('mousemove', (e) => {
    tooltip.style.left = `${e.pageX + 15}px`;
    tooltip.style.top = `${e.pageY + 15}px`;
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.classList.contains('character-name')) tooltip.style.display = 'none';
  });
}
