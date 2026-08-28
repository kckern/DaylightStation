// schoolPathModel.js — URL parsing/building for SchoolApp.jsx's section and
// materials-chain routing, split out so Fast Refresh can hot-reload the app
// shell on its own.


// The surface-profile screen id (spec §4.2): the same /screen(s)/<id> mount
// schoolUrlBase() already parses, re-read off the resolved base rather than
// re-matching the pathname. A standalone app mount (/school, /app/school) —
// or any base that isn't a screen mount — carries no screen id, so it
// resolves to the generic 'browser' surface.
export function screenIdFromUrlBase(urlBase) {
  const m = urlBase && urlBase.match(/^\/screens?\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : 'browser';
}

// Everything after a `subject/<id>` or `library` section is the MATERIALS
// CHAIN — the raw id segments the breadcrumb descends through (collection →
// work → track, or show → episode). So the URL matches the breadcrumb all the
// way down, and a leaf like `…/483194/483214/483215` deep-links straight to a
// playing track. The `plex:` source prefix is dropped in the URL (it's the
// default) and re-added when reading a bare id; a non-plex id keeps its own
// `prefix:` so it round-trips unchanged.
const stripSource = (id) => String(id).replace(/^plex:/, '');
const restoreSource = (seg) => (seg.includes(':') ? seg : `plex:${seg}`);

export function parseSchoolPath(urlBase) {
  const empty = { section: null, materialPath: [] };
  if (!urlBase) return empty;
  const seg = window.location.pathname.slice(urlBase.length).split('/').filter(Boolean).map(decodeURIComponent);
  if (!seg.length) return empty;
  if (seg[0] === 'subject' && seg[1]) return { section: `subject:${seg[1]}`, materialPath: seg.slice(2).map(restoreSource) };
  if (seg[0] === 'library') return { section: 'library', materialPath: seg.slice(1).map(restoreSource) };
  if (seg[0] === 'catalog') return { section: 'catalog', materialPath: [] };
  if (seg[0] === 'progress') return { section: 'progress', materialPath: [] };
  if (seg[0] === 'practice') return { section: 'banks', materialPath: [] };
  if (seg[0] === 'print') return { section: 'print', materialPath: [] };
  if (seg[0] === 'typing') return { section: 'typing', materialPath: [] };
  if (seg[0] === 'geography') return { section: 'geography', materialPath: [] };
  if (seg[0] === 'chess') return { section: 'chess', materialPath: [] };
  if (seg[0] === 'rubiks-cube') return { section: 'rubiks-cube', materialPath: [] };
  // Teacher-only entry into a stateless runner.  This is explicitly separate
  // from the learner launch below: no learner can be reconstructed from a
  // deep link and no grant is accepted here.
  if (seg[0] === 'sentence-ladder-preview' && seg[1]) return { section: `sentence-ladder-preview:${seg[1]}`, materialPath: [] };
  // Teacher-only look at a launch card, on the same terms. The segment is an
  // opaque payload naming a learner and a subject; the backend decodes it and
  // resolves the card through the panel's own read-only resolver, so nothing is
  // minted and nothing is granted. Carried through byte-for-byte — this parser
  // never re-encodes it, because a payload that arrived unreadable must reach
  // the backend unreadable and come back with a sentence saying so.
  if (seg[0] === 'launch-preview' && seg[1]) return { section: `launch-preview:${seg[1]}`, materialPath: [] };
  // Sentence Ladder authority is memory-only. A direct URL or reload must
  // return to School rather than reconstructing a learner-scoped launch.
  return empty;
}

function sectionPathFor(urlBase, section) {
  if (section === null) return urlBase;
  if (section.startsWith('subject:')) return `${urlBase}/subject/${encodeURIComponent(section.slice(8))}`;
  if (section === 'library') return `${urlBase}/library`;
  if (section === 'catalog') return `${urlBase}/catalog`;
  if (section === 'progress') return `${urlBase}/progress`;
  if (section === 'banks') return `${urlBase}/practice`;
  if (section === 'print') return `${urlBase}/print`;
  if (section === 'typing') return `${urlBase}/typing`;
  if (section === 'geography') return `${urlBase}/geography`;
  if (section === 'chess') return `${urlBase}/chess`;
  if (section === 'rubiks-cube') return `${urlBase}/rubiks-cube`;
  if (section.startsWith('sentence-ladder-preview:')) return `${urlBase}/sentence-ladder-preview/${encodeURIComponent(section.slice(24))}`;
  if (section.startsWith('launch-preview:')) return `${urlBase}/launch-preview/${encodeURIComponent(section.slice(15))}`;
  if (section.startsWith('sentence-ladder:')) return `${urlBase}/sentence-ladder/${encodeURIComponent(section.slice(16))}`;
  return urlBase;
}

// Full path = the section path + the materials chain (subject/library only),
// with the `plex:` prefix dropped from each id so the URL stays clean.
export function schoolPathFor(urlBase, section, materialPath = []) {
  const base = sectionPathFor(urlBase, section);
  const carriesChain = section && (section.startsWith('subject:') || section === 'library');
  if (!carriesChain || !materialPath.length) return base;
  return `${base}/${materialPath.map((id) => encodeURIComponent(stripSource(id))).join('/')}`;
}


