/**
 * NewspaperRenderer (1_rendering, pure) — the office paper's page.
 *
 * Draws an edition's layout contract onto a 576-dot canvas (80 mm thermal
 * paper, 72 mm printable at 8 dots/mm), the full height of the paper. No I/O
 * beyond font registration; the caller turns the canvas into a PNG.
 *
 *   render(layout)     → { canvas, width: 576, height, heightCm, lines }
 *   measure(layout)    → { height, heightCm } without drawing (fit loop)
 *   renderText(layout) → plain-text transcript for previews and print logs
 *
 * Layout contract (spec §4):
 *   { masthead: { title, dateLabel, number, tagline?, weatherLabel? },
 *     blocks: [ weather | agenda | tasks | lead | section | briefs | note | footer ] }
 * Weather, agenda and tasks share the "Your day" box under the masthead;
 * notes share a box before the footer. Pure black on white: no grey fills.
 *
 * Typeface: Roboto Condensed only (house canon), Regular and SemiBold, from
 * the bundled `__backend/assets/fonts/roboto-condensed/` the school documents
 * use. `lines` lists every text line drawn with its box, so tests can prove
 * nothing runs past the margin.
 */
import { initCanvas } from '#rendering/lib/CanvasFactory.mjs';

export const PAPER_WIDTH = 576;
const DOTS_PER_CM = 80;
const MARGIN = 12;
const CONTENT = PAPER_WIDTH - 2 * MARGIN;
const FAMILY = 'Roboto Condensed';
const FONT_FILES = {
  regular: 'roboto-condensed/RobotoCondensed-Regular.ttf',
  bold: 'roboto-condensed/RobotoCondensed-SemiBold.ttf',
};

const INK = '#000000';
const PAPER = '#ffffff';

const font = (size, bold = false) => `${bold ? 'bold ' : ''}${size}px "${FAMILY}"`;

const T = {
  masthead: { max: 64, min: 40, spacing: -1 },
  dateline: { size: 17, bold: true, spacing: 1 },
  tagline: { size: 16, spacing: 1 },
  box: { pad: 12, border: 3 },
  boxLabel: { size: 15, bold: true, spacing: 2 },
  dayText: { size: 20, line: 25 },
  dayBig: { size: 46 },
  lead: { size: 38, line: 41 },
  headline: { size: 30, line: 33 },
  body: { size: 22, line: 29 },
  credit: { size: 16, line: 20, spacing: 1 },
  bar: { size: 20, height: 34, spacing: 3 },
  brief: { size: 20, line: 26 },
  footer: { size: 16, line: 21 },
};

const DAY_TYPES = new Set(['weather', 'agenda', 'tasks']);

/** Word wrap that also breaks a single word wider than the line. */
export function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const paragraph of String(text ?? '').split(/\n+/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';
    for (let word of words) {
      while (ctx.measureText(word).width > maxWidth && word.length > 1) {
        // Hard-break an unbreakable token (a long URL) at the widest fit.
        if (line) { out.push(line); line = ''; }
        let cut = word.length - 1;
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut -= 1;
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const test = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function spacedWidth(ctx, text, spacing) {
  const chars = [...String(text)];
  return chars.reduce((w, ch) => w + ctx.measureText(ch).width, 0) + spacing * Math.max(0, chars.length - 1);
}

/**
 * A two-pass painter: every draw call records the y it needs, so the same
 * code measures (no canvas) and paints (canvas of the measured height).
 */
class Painter {
  constructor(ctx, { draw }) {
    this.ctx = ctx;
    this.draw = draw;
    this.y = 0;
    this.lines = [];
  }

  setFont(size, bold) { this.ctx.font = font(size, bold); }

  text(str, x, y, { align = 'left', width = null, spacing = 0, color = INK } = {}) {
    const w = spacing ? spacedWidth(this.ctx, str, spacing) : this.ctx.measureText(str).width;
    let left = x;
    if (align === 'center') left = x + ((width ?? CONTENT) - w) / 2;
    if (align === 'right') left = x + (width ?? CONTENT) - w;
    this.lines.push({ text: str, x: left, y, width: w });
    if (!this.draw) return w;
    this.ctx.fillStyle = color;
    if (!spacing) {
      this.ctx.fillText(str, left, y);
    } else {
      let cx = left;
      for (const ch of str) {
        this.ctx.fillText(ch, cx, y);
        cx += this.ctx.measureText(ch).width + spacing;
      }
    }
    return w;
  }

  rect(x, y, w, h, color = INK) {
    if (!this.draw) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  frame(x, y, w, h, t) {
    this.rect(x, y, w, t);
    this.rect(x, y + h - t, w, t);
    this.rect(x, y, t, h);
    this.rect(x + w - t, y, t, h);
  }

  /** Wrapped paragraph at the cursor; returns lines drawn. */
  para(str, { size, line, bold = false, x = MARGIN, width = CONTENT, align = 'left' }) {
    this.setFont(size, bold);
    const lines = wrapLines(this.ctx, str, width);
    for (const l of lines) {
      this.text(l, x, this.y, { align, width });
      this.y += line;
    }
    return lines.length;
  }
}

function creditText(sources) {
  const list = (sources || []).filter(Boolean);
  return list.length ? list.join(' · ').toUpperCase() : '';
}

function paintMasthead(p, masthead = {}) {
  const title = String(masthead.title || 'The Paper');
  let size = T.masthead.max;
  p.setFont(size, true);
  while (size > T.masthead.min && spacedWidth(p.ctx, title, T.masthead.spacing) > CONTENT) {
    size -= 2;
    p.setFont(size, true);
  }
  p.y += 8;
  p.text(title, MARGIN, p.y, { align: 'center', spacing: T.masthead.spacing });
  // Clear the descenders (g, y) before the rule: top baseline + ~1.2 em.
  p.y += Math.round(size * 1.22);
  if (masthead.tagline) {
    p.setFont(T.tagline.size, false);
    p.text(String(masthead.tagline).toUpperCase(), MARGIN, p.y, { align: 'center', spacing: T.tagline.spacing });
    p.y += 24;
  }
  // Double rule: heavy over hairline.
  p.rect(MARGIN, p.y, CONTENT, 4);
  p.rect(MARGIN, p.y + 7, CONTENT, 2);
  p.y += 16;
  const parts = [masthead.dateLabel, masthead.number != null ? `NO. ${masthead.number}` : null, masthead.weatherLabel]
    .filter(Boolean).map((s) => String(s).toUpperCase());
  p.setFont(T.dateline.size, T.dateline.bold);
  let line = parts.join('  ·  ');
  if (spacedWidth(p.ctx, line, T.dateline.spacing) > CONTENT) line = parts.join(' · ');
  p.text(line, MARGIN, p.y, { align: 'center', spacing: spacedWidth(p.ctx, line, T.dateline.spacing) > CONTENT ? 0 : T.dateline.spacing });
  p.y += 24;
  p.rect(MARGIN, p.y, CONTENT, 2);
  p.y += 16;
}

function boxLabel(p, label, x, width) {
  p.setFont(T.boxLabel.size, T.boxLabel.bold);
  p.text(String(label).toUpperCase(), x, p.y, { spacing: T.boxLabel.spacing, width });
  p.y += 19;
  p.rect(x, p.y, width, 1);
  p.y += 7;
}

function paintWeather(p, b, x, width) {
  boxLabel(p, 'Weather', x, width);
  p.setFont(T.dayBig.size, true);
  const hi = b.high != null ? `${Math.round(b.high)}°` : '—';
  const lo = b.low != null ? `${Math.round(b.low)}°` : '—';
  const hiW = p.text(hi, x, p.y);
  p.setFont(26, false);
  p.text(` / ${lo}`, x + hiW, p.y + 16);
  p.y += 52;
  const lines = [b.condition, b.precipPct != null ? `Precip ${Math.round(b.precipPct)}%` : null].filter(Boolean);
  for (const l of lines) p.para(l, { size: T.dayText.size, line: T.dayText.line, x, width, bold: l === b.condition });
  if (b.note) {
    p.y += 4;
    p.para(b.note, { size: 18, line: 23, x, width });
  }
}

function paintList(p, b, x, width) {
  boxLabel(p, b.label || (b.type === 'tasks' ? 'To do' : 'Today'), x, width);
  const items = b.items || [];
  if (!items.length) {
    p.para(b.type === 'tasks' ? 'Nothing due.' : 'Nothing scheduled.', { size: T.dayText.size, line: T.dayText.line, x, width });
    return;
  }
  // One time column for every row, as wide as the widest time.
  p.setFont(18, true);
  const timeOf = (item) => (item.time ? String(item.time) : 'All day');
  const tw = b.type === 'agenda'
    ? Math.min(width / 2, Math.max(56, ...items.map((item) => p.ctx.measureText(timeOf(item)).width)) + 10)
    : 0;
  for (const item of items) {
    if (b.type === 'agenda') {
      p.setFont(18, true);
      p.text(timeOf(item), x, p.y + 2);
      const start = p.y;
      p.para(item.text, { size: T.dayText.size, line: T.dayText.line, x: x + tw, width: width - tw });
      if (p.y === start) p.y += T.dayText.line;
    } else {
      // A drawn checkbox (the face has no box glyph); filled when overdue.
      if (item.overdue) p.rect(x, p.y + 5, 13, 13);
      else p.frame(x, p.y + 5, 13, 13, 2);
      p.para(item.text, { size: T.dayText.size, line: T.dayText.line, x: x + 20, width: width - 20, bold: !!item.overdue });
    }
    p.y += 3;
  }
}

/** The "Your day" box: weather on the left, agenda and tasks on the right. */
function paintDayBox(p, dayBlocks) {
  if (!dayBlocks.length) return;
  const { pad, border } = T.box;
  const top = p.y;
  const weather = dayBlocks.find((b) => b.type === 'weather');
  const lists = dayBlocks.filter((b) => b.type !== 'weather');
  const inner = CONTENT - 2 * pad - 2 * border;
  const leftW = weather && lists.length ? 190 : inner;
  const gutter = weather && lists.length ? 18 : 0;
  const rightW = weather ? inner - leftW - gutter : inner;
  const x0 = MARGIN + border + pad;

  p.y = top + border + pad;
  let leftBottom = p.y;
  if (weather) {
    paintWeather(p, weather, x0, leftW);
    leftBottom = p.y;
  }
  p.y = top + border + pad;
  const rx = weather ? x0 + leftW + gutter : x0;
  lists.forEach((b, i) => {
    if (i > 0) p.y += 10;
    paintList(p, b, rx, rightW);
  });
  const rightBottom = p.y;
  const bottom = Math.max(leftBottom, rightBottom) + pad - 3 + border;
  p.frame(MARGIN, top, CONTENT, bottom - top, border);
  if (weather && lists.length) p.rect(x0 + leftW + gutter / 2 - 1, top + border + pad, 2, bottom - top - 2 * (border + pad));
  p.y = bottom + 18;
}

function paintBar(p, label) {
  p.rect(MARGIN, p.y, CONTENT, T.bar.height);
  p.setFont(T.bar.size, true);
  p.text(String(label).toUpperCase(), MARGIN + 10, p.y + (T.bar.height - T.bar.size) / 2 - 1, { spacing: T.bar.spacing, color: PAPER });
  p.y += T.bar.height + 12;
}

function paintCredit(p, sources) {
  const credit = creditText(sources);
  if (!credit) return;
  p.y += 2;
  p.setFont(T.credit.size, true);
  const lines = wrapLines(p.ctx, credit, CONTENT - 20);
  for (const l of lines) {
    p.text(`— ${l}`, MARGIN, p.y, { spacing: 0 });
    p.y += T.credit.line;
  }
}

function paintStory(p, story, { lead = false } = {}) {
  const hs = lead ? T.lead : T.headline;
  p.para(story.headline, { size: hs.size, line: hs.line, bold: true });
  p.y += lead ? 6 : 4;
  p.para(story.body, { size: T.body.size, line: T.body.line });
  paintCredit(p, story.sources);
}

function paintLead(p, b) {
  p.setFont(T.boxLabel.size, true);
  p.text('THE LEAD', MARGIN, p.y, { spacing: T.boxLabel.spacing });
  p.y += 22;
  paintStory(p, b, { lead: true });
  p.y += 12;
  p.rect(MARGIN, p.y, CONTENT, 4);
  p.y += 20;
}

function paintSection(p, b) {
  paintBar(p, b.label);
  (b.stories || []).forEach((story, i) => {
    if (i > 0) {
      p.y += 8;
      p.rect(MARGIN + CONTENT * 0.3, p.y, CONTENT * 0.4, 1);
      p.y += 14;
    }
    paintStory(p, story);
  });
  p.y += 18;
}

function paintBriefs(p, b) {
  paintBar(p, b.label || 'In brief');
  for (const item of b.items || []) {
    p.rect(MARGIN + 2, p.y + 8, 9, 9);
    const text = item.source ? `${item.text} (${item.source})` : item.text;
    p.para(text, { size: T.brief.size, line: T.brief.line, x: MARGIN + 22, width: CONTENT - 22 });
    p.y += 6;
  }
  p.y += 12;
}

function paintNotes(p, notes) {
  if (!notes.length) return;
  const { pad } = T.box;
  const border = 2;
  const top = p.y;
  const x = MARGIN + border + pad;
  const width = CONTENT - 2 * (border + pad);
  p.y = top + border + pad;
  notes.forEach((n, i) => {
    if (i > 0) p.y += 10;
    p.setFont(T.boxLabel.size, true);
    p.text(String(n.label || 'Note').toUpperCase(), x, p.y, { spacing: T.boxLabel.spacing });
    p.y += 20;
    p.para(n.text, { size: T.dayText.size, line: T.dayText.line, x, width });
  });
  const bottom = p.y + pad - 3 + border;
  p.frame(MARGIN, top, CONTENT, bottom - top, border);
  p.y = bottom + 16;
}

function paintFooter(p, b) {
  p.rect(MARGIN, p.y, CONTENT, 2);
  p.y += 10;
  p.para(b.text, { size: T.footer.size, line: T.footer.line, align: 'center' });
  p.y += 6;
}

function paintAll(p, layout) {
  const blocks = layout?.blocks || [];
  paintMasthead(p, layout?.masthead);
  paintDayBox(p, blocks.filter((b) => DAY_TYPES.has(b.type)));
  const notes = blocks.filter((b) => b.type === 'note');
  for (const b of blocks) {
    if (b.type === 'lead') paintLead(p, b);
    else if (b.type === 'section') paintSection(p, b);
    else if (b.type === 'briefs') paintBriefs(p, b);
  }
  paintNotes(p, notes);
  const footer = blocks.find((b) => b.type === 'footer');
  if (footer) paintFooter(p, footer);
  p.y += 4;
  return Math.ceil(p.y);
}

export class NewspaperRenderer {
  #fontDir;

  /** @param {{ fontDir?: string }} [opts] - override the bundled font root */
  constructor({ fontDir } = {}) {
    this.#fontDir = fontDir;
  }

  async #canvas(width, height) {
    return initCanvas({
      width, height, fontDir: this.#fontDir,
      fontFile: FONT_FILES.regular, fontFamily: FAMILY,
      extraFonts: [{ file: FONT_FILES.bold, family: FAMILY, weight: 'bold' }],
    });
  }

  /** @returns {Promise<{ height: number, heightCm: number }>} */
  async measure(layout) {
    const { ctx } = await this.#canvas(1, 1);
    const height = paintAll(new Painter(ctx, { draw: false }), layout);
    return { height, heightCm: height / DOTS_PER_CM };
  }

  /**
   * @param {object} layout - the layout contract
   * @returns {Promise<{ canvas: object, width: number, height: number, heightCm: number, lines: Array<{text, x, y, width}> }>}
   */
  async render(layout) {
    const { height } = await this.measure(layout);
    const { canvas, ctx } = await this.#canvas(PAPER_WIDTH, height);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PAPER_WIDTH, height);
    const painter = new Painter(ctx, { draw: true });
    paintAll(painter, layout);
    return { canvas, width: PAPER_WIDTH, height, heightCm: height / DOTS_PER_CM, lines: painter.lines };
  }

  /** Plain-text transcript of the layout (newsstand preview, print log). */
  renderText(layout) {
    return renderLayoutText(layout);
  }
}

const RULE = '='.repeat(48);
const THIN = '-'.repeat(48);

function wrapPlain(text, width = 48) {
  const out = [];
  let line = '';
  for (const word of String(text ?? '').split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > width) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

export function renderLayoutText(layout) {
  const out = [];
  const m = layout?.masthead || {};
  out.push(String(m.title || '').toUpperCase());
  if (m.tagline) out.push(m.tagline);
  out.push(RULE);
  out.push([m.dateLabel, m.number != null ? `No. ${m.number}` : null, m.weatherLabel].filter(Boolean).join(' · '));
  out.push(RULE);
  const blocks = layout?.blocks || [];
  for (const b of blocks) {
    if (b.type === 'weather') {
      out.push(`WEATHER: ${b.condition || ''} ${b.high != null ? Math.round(b.high) : '-'}°/${b.low != null ? Math.round(b.low) : '-'}°${b.precipPct != null ? ` precip ${Math.round(b.precipPct)}%` : ''}`.trim());
      if (b.note) out.push(...wrapPlain(b.note));
    } else if (b.type === 'agenda' || b.type === 'tasks') {
      out.push(`${String(b.label || b.type).toUpperCase()}:`);
      for (const item of b.items || []) {
        out.push(b.type === 'agenda' ? `  ${item.time || 'All day'}  ${item.text}` : `  ${item.overdue ? '!' : '-'} ${item.text}`);
      }
    }
  }
  for (const b of blocks) {
    if (b.type === 'lead' || b.type === 'section') {
      out.push(THIN);
      if (b.type === 'section') out.push(`[ ${String(b.label).toUpperCase()} ]`);
      const stories = b.type === 'lead' ? [b] : b.stories || [];
      for (const s of stories) {
        out.push(...wrapPlain(String(s.headline).toUpperCase()));
        out.push(...wrapPlain(s.body));
        const credit = creditText(s.sources);
        if (credit) out.push(`  -- ${credit}`);
        out.push('');
      }
    } else if (b.type === 'briefs') {
      out.push(THIN);
      out.push(`[ ${String(b.label || 'In brief').toUpperCase()} ]`);
      for (const item of b.items || []) out.push(...wrapPlain(`* ${item.text}${item.source ? ` (${item.source})` : ''}`));
    }
  }
  const notes = blocks.filter((b) => b.type === 'note');
  if (notes.length) {
    out.push(THIN);
    for (const n of notes) out.push(...wrapPlain(`${String(n.label || 'Note').toUpperCase()}: ${n.text}`));
  }
  const footer = blocks.find((b) => b.type === 'footer');
  if (footer) {
    out.push(RULE);
    out.push(footer.text);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export default NewspaperRenderer;
