import { COLORS, FACES, isValidCube } from './engine.mjs';

const FACE_ORIGIN = Object.freeze({ U: [90, 0], L: [0, 90], F: [90, 90], R: [180, 90], B: [270, 90], D: [90, 180] });
const ROLE = Object.freeze({ white: 'W', yellow: 'Y', red: 'R', orange: 'O', green: 'G', blue: 'B' });
// Labels carry the colour identity.  The light fill is only a secondary visual
// cue: no hatching, stippling, or texture competes with the letter on paper.
const MONO_FILL = Object.freeze({ white: '#ffffff', yellow: '#f2f2f2', red: '#e6e6e6', orange: '#d9d9d9', green: '#cccccc', blue: '#bfbfbf' });
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function cell(face, index) {
  const [left, top] = FACE_ORIGIN[face];
  return { x: left + (index % 3) * 30, y: top + Math.floor(index / 3) * 30 };
}

/** A print-safe SVG cube net. Colour letters remain meaningful on a monochrome
 * laser printer; the five non-white roles use only light gray fills. */
export function cubeDiagramSvg(cube, { title = 'Rubik’s Cube diagram', monochrome = true, highlights = [], arrows = [] } = {}) {
  if (!isValidCube(cube)) throw new Error('A valid cube is required to render a diagram.');
  const highlighted = new Set(highlights.map(({ face, index }) => `${face}:${index}`));
  const definitions = `<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7Z" fill="#111"/></marker></defs>`;
  const stickers = FACES.flatMap((face) => cube[face].map((color, index) => {
    const { x, y } = cell(face, index); const role = ROLE[color] || '?';
    const fill = monochrome ? (MONO_FILL[color] || '#ffffff') : color;
    const border = highlighted.has(`${face}:${index}`) ? '#a11' : '#111'; const width = highlighted.has(`${face}:${index}`) ? 3 : 1;
    return `<rect x="${x + 1}" y="${y + 1}" width="28" height="28" rx="1" fill="${fill}" stroke="${border}" stroke-width="${width}"/><text x="${x + 15}" y="${y + 19}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" font-weight="700">${role}</text>`;
  })).join('');
  const paths = arrows.map(({ from, to, label = '' }) => {
    const a = cell(from.face, from.index); const b = cell(to.face, to.index);
    return `<path d="M${a.x + 15},${a.y + 15} L${b.x + 15},${b.y + 15}" stroke="#111" stroke-width="2" fill="none" marker-end="url(#arrow)"/><text x="${(a.x + b.x) / 2 + 15}" y="${(a.y + b.y) / 2 + 10}" text-anchor="middle" font-family="Arial, sans-serif" font-size="10">${escape(label)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -25 360 300" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>${definitions}<text x="0" y="-7" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escape(title)}</text>${stickers}${paths}</svg>`;
}

export default { cubeDiagramSvg };
