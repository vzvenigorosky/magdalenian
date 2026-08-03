/**
 * Deterministic pseudo-randomness.
 *
 * Every generated scene is seeded from its (day, hour, location) coordinates,
 * so revisiting a cell always shows the same scene. Without this, navigating
 * away and back would reshuffle the world and the simulation would read as
 * broken rather than persistent.
 */

/** FNV-1a, chosen for being short and stable across runs. */
export function hashSeed(...parts: Array<string | number>): number {
  let hash = 0x811c9dc5;
  const input = parts.join('|');
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [min, max]. */
  int(min: number, max: number): number;
  /** True with the given percentage chance (0-100). */
  chance(percent: number): boolean;
  pick<T>(items: readonly T[]): T | undefined;
}

/** mulberry32 — small, fast, and good enough for narrative variation. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (percent) => next() * 100 < percent,
    pick: (items) => (items.length === 0 ? undefined : items[Math.floor(next() * items.length)]),
  };
}

/**
 * Draws up to `count` distinct entries, with probability proportional to
 * weight. Entries with a weight of zero or less are never drawn.
 */
export function weightedSample(
  weights: Record<string, number>,
  count: number,
  rng: Rng,
): string[] {
  const pool = Object.entries(weights).filter(([, weight]) => weight > 0);
  const chosen: string[] = [];

  while (chosen.length < count && pool.length > 0) {
    const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = rng.next() * total;

    let index = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i]![1];
      if (roll <= 0) {
        index = i;
        break;
      }
    }

    chosen.push(pool[index]![0]);
    pool.splice(index, 1);
  }

  return chosen;
}
