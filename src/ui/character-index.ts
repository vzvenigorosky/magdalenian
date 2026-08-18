/**
 * A browsable index of the band.
 *
 * The 43 characters carry ten descriptions each and a whole kinship graph, and
 * until now the only way to see any of it was to hover a name that happened to
 * appear in a scene. This shows all of them, grouped by family.
 */
import type { CharacterProfiles, CharactersData, Relationships } from '../types.ts';

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

const AGE_LABELS: Record<string, string> = {
  infant: 'infant',
  child: 'child',
  adolescent: 'adolescent',
  adult: 'adult',
  elder: 'elder',
};

function descriptionsOf(character: CharactersData[string]): string[] {
  return Object.entries(character)
    .filter(([key]) => key.startsWith('description'))
    .map(([, value]) => value)
    .filter((value) => typeof value === 'string' && value.length > 0);
}

/** Households: a mated pair (or lone parent) and their children. */
function households(profiles: CharacterProfiles, kin: Relationships): string[][] {
  const claimed = new Set<string>();
  const groups: string[][] = [];

  for (const id of Object.keys(profiles)) {
    if (claimed.has(id)) continue;
    const entry = kin[id];
    if (!entry || entry.children.length === 0) continue;

    const parents = [id, ...entry.mates.filter((m) => (kin[m]?.children.length ?? 0) > 0)];
    const children = [...new Set(parents.flatMap((p) => kin[p]?.children ?? []))];
    const members = [...new Set([...parents, ...children])].filter((m) => !claimed.has(m));
    if (members.length === 0) continue;

    for (const member of members) claimed.add(member);
    groups.push(members);
  }

  const rest = Object.keys(profiles).filter((id) => !claimed.has(id));
  if (rest.length > 0) groups.push(rest);
  return groups;
}

function relationLine(id: string, kin: Relationships, names: Map<string, string>): string {
  const entry = kin[id];
  if (!entry) return '';
  const list = (ids: string[]) => ids.map((x) => names.get(x) ?? x).join(', ');

  const bits: string[] = [];
  if (entry.mates.length) bits.push(`mate of ${list(entry.mates)}`);
  if (entry.parents.length) bits.push(`child of ${list(entry.parents)}`);
  if (entry.children.length) bits.push(`parent of ${list(entry.children)}`);
  if (entry.siblings.length) bits.push(`sibling of ${list(entry.siblings)}`);
  if (entry.grandchildren.length) bits.push(`grandparent of ${list(entry.grandchildren)}`);
  return bits.join(' &middot; ');
}

export function renderCharacterIndex(
  characters: CharactersData,
  profiles: CharacterProfiles,
  kin: Relationships,
): string {
  const names = new Map(Object.entries(characters).map(([id, c]) => [id, c.name]));
  const groups = households(profiles, kin);

  const cards = groups
    .map((group, index) => {
      const isFamily = group.length > 1 && (kin[group[0]!]?.children.length ?? 0) > 0;
      const heading = isFamily
        ? `Household of ${group
            .filter((id) => (kin[id]?.children.length ?? 0) > 0)
            .map((id) => names.get(id))
            .join(' and ')}`
        : index === groups.length - 1
          ? 'Without recorded kin'
          : 'Household';

      const people = group
        .map((id) => {
          const character = characters[id];
          const profile = profiles[id];
          if (!character || !profile) return '';
          const age = profile.age !== undefined ? `, ${profile.age} winters` : '';
          const roles = profile.roles.length
            ? ` &middot; ${profile.roles.map(escapeHtml).join(', ')}`
            : '';
          const relations = relationLine(id, kin, names);

          return `
            <div class="py-3 border-b border-gray-800 last:border-0">
              <div class="flex flex-wrap items-baseline gap-x-2">
                <span class="character-name text-lg" data-char-id="${escapeHtml(id)}">${escapeHtml(
                  character.name,
                )}</span>
                <span class="text-sm text-gray-500">${AGE_LABELS[profile.ageBand] ?? profile.ageBand}${age}${roles}</span>
              </div>
              ${relations ? `<p class="text-sm text-gray-500 mt-1">${relations}</p>` : ''}
              <ul class="mt-2 text-sm text-gray-400 space-y-1">
                ${descriptionsOf(character)
                  .map((d) => `<li>${escapeHtml(d)}</li>`)
                  .join('')}
              </ul>
            </div>`;
        })
        .join('');

      return `
        <section class="card rounded-lg p-4">
          <h3 class="font-title text-xl text-[#c7a78a] mb-2">${escapeHtml(heading)}</h3>
          ${people}
        </section>`;
    })
    .join('');

  return `
    <div class="flex items-baseline justify-between mb-4">
      <h2 class="font-title text-3xl text-[#c7a78a]">The Band</h2>
      <button id="close-index" class="chip rounded px-3 py-1 text-sm">close</button>
    </div>
    <p class="text-sm text-gray-500 mb-4">
      ${Object.keys(characters).length} people. Ages and roles are derived from the descriptions;
      kinship is read from them too.
    </p>
    <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">${cards}</div>`;
}
