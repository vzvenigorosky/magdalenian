import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, weightedSample } from '../src/sim/rng.ts';

describe('hashSeed', () => {
  it('is stable for the same inputs', () => {
    expect(hashSeed(1, 9, 'loc0')).toBe(hashSeed(1, 9, 'loc0'));
  });

  it('separates adjacent coordinates', () => {
    const seeds = new Set([
      hashSeed(1, 9, 'loc0'),
      hashSeed(1, 10, 'loc0'),
      hashSeed(2, 9, 'loc0'),
      hashSeed(1, 9, 'loc1'),
    ]);
    expect(seeds.size).toBe(4);
  });

  it('does not collide across the whole simulation grid', () => {
    const seeds = new Set<number>();
    for (let day = 1; day <= 365; day += 7) {
      for (let hour = 0; hour < 24; hour++) {
        for (const loc of ['loc0', 'loc13', 'loc22', 'loc65']) {
          seeds.add(hashSeed(day, hour, loc));
        }
      }
    }
    expect(seeds.size).toBe(53 * 24 * 4);
  });
});

describe('createRng', () => {
  it('replays the same sequence from the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const draw = (r: ReturnType<typeof createRng>) => [r.next(), r.next(), r.next()];
    expect(draw(a)).toEqual(draw(b));
  });

  it('stays within [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 5000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() covers the inclusive range without escaping it', () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const value = rng.int(3, 6);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(6);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('chance() honours its percentage within tolerance', () => {
    const rng = createRng(4242);
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rng.chance(25)) hits++;
    expect(hits / 20000).toBeGreaterThan(0.23);
    expect(hits / 20000).toBeLessThan(0.27);
  });

  it('chance(0) never fires and chance(100) always does', () => {
    const rng = createRng(1);
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(100)).toBe(true);
    }
  });
});

describe('weightedSample', () => {
  const weights = { common: 90, rare: 9, veryRare: 1, never: 0 };

  it('never draws zero-weight entries', () => {
    for (let seed = 0; seed < 300; seed++) {
      expect(weightedSample(weights, 3, createRng(seed))).not.toContain('never');
    }
  });

  it('draws without replacement', () => {
    const drawn = weightedSample(weights, 3, createRng(5));
    expect(new Set(drawn).size).toBe(drawn.length);
  });

  it('cannot draw more than the pool holds', () => {
    // Only three entries have a weight above zero.
    expect(weightedSample(weights, 10, createRng(5))).toHaveLength(3);
  });

  it('favours heavier entries', () => {
    let commonFirst = 0;
    for (let seed = 0; seed < 1000; seed++) {
      if (weightedSample(weights, 1, createRng(seed))[0] === 'common') commonFirst++;
    }
    expect(commonFirst / 1000).toBeGreaterThan(0.8);
  });

  it('returns nothing when every weight is zero', () => {
    expect(weightedSample({ a: 0, b: 0 }, 2, createRng(1))).toEqual([]);
  });

  it('is deterministic for a given seed', () => {
    expect(weightedSample(weights, 3, createRng(77))).toEqual(weightedSample(weights, 3, createRng(77)));
  });
});
