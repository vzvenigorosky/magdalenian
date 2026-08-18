/**
 * The family graph is derived from prose, so these tests guard both the
 * extraction and any hand-edits made to `data/relationships.json` afterwards.
 */
import { describe, expect, it } from 'vitest';
import { characters, profiles, relationships } from './helpers.ts';

const nameOf = (id: string) => characters[id]?.name ?? id;

describe('relationship graph', () => {
  it('covers every character', () => {
    expect(Object.keys(relationships).sort()).toEqual(Object.keys(characters).sort());
  });

  it('references only real characters', () => {
    for (const [id, kin] of Object.entries(relationships)) {
      for (const ids of Object.values(kin)) {
        for (const other of ids) {
          expect(characters[other], `${nameOf(id)} -> ${other}`).toBeDefined();
        }
      }
    }
  });

  it('never relates anyone to themselves', () => {
    for (const [id, kin] of Object.entries(relationships)) {
      for (const ids of Object.values(kin)) {
        expect(ids, nameOf(id)).not.toContain(id);
      }
    }
  });

  it('is symmetric — every link is recorded from both sides', () => {
    for (const [id, kin] of Object.entries(relationships)) {
      for (const mate of kin.mates) expect(relationships[mate]!.mates, nameOf(id)).toContain(id);
      for (const sibling of kin.siblings) {
        expect(relationships[sibling]!.siblings, nameOf(id)).toContain(id);
      }
      for (const child of kin.children) expect(relationships[child]!.parents, nameOf(id)).toContain(id);
      for (const parent of kin.parents) expect(relationships[parent]!.children, nameOf(id)).toContain(id);
      for (const gc of kin.grandchildren) {
        expect(relationships[gc]!.grandparents, nameOf(id)).toContain(id);
      }
    }
  });

  it('has no duplicate entries', () => {
    for (const kin of Object.values(relationships)) {
      for (const ids of Object.values(kin)) expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps generations the right way round', () => {
    const rank = { infant: 0, child: 1, adolescent: 2, adult: 3, elder: 4 };
    for (const [id, kin] of Object.entries(relationships)) {
      const self = profiles[id]!;
      for (const child of kin.children) {
        const other = profiles[child]!;
        expect(
          rank[self.ageBand] >= rank[other.ageBand],
          `${self.name} (${self.ageBand}) is parent of ${other.name} (${other.ageBand})`,
        ).toBe(true);
      }
    }
  });

  it('never makes anyone their own ancestor', () => {
    for (const id of Object.keys(relationships)) {
      const seen = new Set<string>();
      const walk = (current: string, depth: number): void => {
        if (depth > 6 || seen.has(current)) return;
        seen.add(current);
        for (const parent of relationships[current]?.parents ?? []) {
          expect(parent, `${nameOf(id)} is their own ancestor`).not.toBe(id);
          walk(parent, depth + 1);
        }
      };
      walk(id, 0);
    }
  });

  it('found the families the prose actually states', () => {
    const kinOf = (name: string) =>
      relationships[Object.keys(characters).find((k) => characters[k]!.name === name)!]!;
    const names = (ids: string[]) => ids.map(nameOf).sort();

    // "She is the mate of Aitor and mother of Sua."
    expect(names(kinOf('Lurra').mates)).toContain('Aitor');
    expect(names(kinOf('Lurra').children)).toContain('Sua');
    // "He is the grandfather of Kemen and Sua."
    expect(names(kinOf('Zahar').grandchildren).sort()).toEqual(['Kemen', 'Sua']);
    // "She is the mother of Nahia, Haizea, and Santi." — a three-way list.
    expect(names(kinOf('Itxaso').children)).toEqual(['Haizea', 'Nahia', 'Santi']);
    // Siblings inferred from shared parents, though no line states it.
    expect(names(kinOf('Haizea').siblings)).toEqual(['Nahia', 'Santi']);
    // "She is Nerea's younger sister and mate of Mikel."
    expect(names(kinOf('Itxaso').siblings ?? [])).not.toContain('Itxaso');
    expect(names(kinOf('Nerea').siblings)).toContain('Itxaso');
  });

  it('leaves the outsider without kin', () => {
    // Gizon is "A man who came from another band".
    const gizon = Object.keys(characters).find((k) => characters[k]!.name === 'Gizon')!;
    const kin = relationships[gizon]!;
    expect(Object.values(kin).every((ids) => ids.length === 0)).toBe(true);
  });

  it('gives most children a recorded parent', () => {
    const young = Object.values(profiles).filter(
      (p) => p.ageBand === 'infant' || p.ageBand === 'child' || p.ageBand === 'adolescent',
    );
    const withParents = young.filter((p) => (relationships[p.id]?.parents.length ?? 0) > 0);
    expect(withParents.length / young.length).toBeGreaterThan(0.8);
  });
});
