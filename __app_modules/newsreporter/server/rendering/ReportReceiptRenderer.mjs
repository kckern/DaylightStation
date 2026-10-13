/**
 * Report Receipt Renderer (1_rendering, pure)
 *
 * Maps validated report sections (the reportSchema published language) to a
 * thermal-printer PrintJob POJO: { items: PrintItem[], footer: {...} }.
 *
 * This module is PURE: no I/O, no logging, no imports from 1_adapters. It is
 * the single owner of receipt layout, so it pre-expands tables into text rows
 * here rather than emitting a `table` print item for an adapter to expand.
 *
 * PrintItem shape (consumed by ThermalPrinterAdapter):
 *   { type: 'text'|'line'|'space', content?, align?, size?, style?, width? }
 * PrintJob footer shape: { paddingLines: number, autoCut: boolean }
 *
 * @module 1_rendering/newsreporter/ReportReceiptRenderer
 */

const DEFAULT_WIDTH = 48;

export class ReportReceiptRenderer {
  /**
   * @param {{ width?: number }} [opts]
   */
  constructor(opts = {}) {
    this.width = opts.width || DEFAULT_WIDTH;
  }

  /**
   * Render sections to a PrintJob POJO.
   * @param {Array} sections validated report sections
   * @param {object} [template] { header, divider, footer, autoCut, width }
   * @param {object} [ctx] reserved for future use (kept pure)
   * @returns {{ items: Array, footer: { paddingLines: number, autoCut: boolean } }}
   */
  render(sections = [], template = {}, ctx = {}) {
    const width = template.width || this.width;
    const items = [];

    if (template.header) {
      items.push({
        type: 'text',
        content: String(template.header),
        align: 'center',
        size: { width: 2, height: 2 },
        style: { bold: true },
      });
    }

    if (template.divider) {
      items.push({ type: 'line', width });
    }

    for (const section of sections || []) {
      items.push(...this.#renderSection(section, width));
    }

    if (template.footer) {
      items.push({ type: 'space', lines: 1 });
      items.push({ type: 'text', content: String(template.footer), align: 'center' });
    }

    return {
      items,
      footer: {
        paddingLines: 3,
        autoCut: template.autoCut !== false,
      },
    };
  }

  /**
   * Plain-text approximation of the receipt, for dryRun/CLI preview.
   * Reuses the same section walk so previews match the printed layout.
   * @param {Array} sections
   * @param {object} [template]
   * @param {object} [ctx]
   * @returns {string}
   */
  renderText(sections = [], template = {}, ctx = {}) {
    const width = template.width || this.width;
    const lines = [];

    if (template.header) {
      lines.push(centerText(String(template.header), width));
      lines.push('='.repeat(width));
    } else if (template.divider) {
      lines.push('-'.repeat(width));
    }

    for (const section of sections || []) {
      switch (section?.type) {
        case 'heading':
          lines.push('');
          lines.push(centerText(String(section.text), width));
          break;
        case 'lines':
          for (const line of section.lines || []) lines.push(String(line));
          break;
        case 'table':
          lines.push(...formatTableLines(section, width));
          break;
        case 'note':
          lines.push(centerText(String(section.text), width));
          break;
        default:
          break;
      }
    }

    if (template.footer) {
      lines.push('');
      lines.push(centerText(String(template.footer), width));
    }

    return lines.join('\n');
  }

  /**
   * @param {object} section
   * @param {number} width
   * @returns {Array} print items
   */
  #renderSection(section, width) {
    switch (section?.type) {
      case 'heading':
        return [{ type: 'text', content: String(section.text), align: 'center', style: { bold: true } }];
      case 'lines':
        return (section.lines || []).map(line => ({
          type: 'text',
          content: String(line),
          align: 'left',
        }));
      case 'table':
        return formatTableLines(section, width).map(content => ({
          type: 'text',
          content,
          align: 'left',
        }));
      case 'note':
        return [{ type: 'text', content: String(section.text), align: 'center' }];
      default:
        return [];
    }
  }
}

// ─── Pure layout helpers ──────────────────────────────────

function centerText(str, width) {
  const s = String(str || '');
  if (s.length >= width) return s.slice(0, width);
  const padding = width - s.length;
  const left = Math.floor(padding / 2);
  return ' '.repeat(left) + s;
}

/**
 * Format a table section into fixed-width text rows (monospace receipt grid).
 * Mirrors ThermalPrinterAdapter.createTablePrint column math so the renderer
 * stays the single layout owner.
 * @param {{ headers?: string[], rows?: string[][] }} section
 * @param {number} width
 * @returns {string[]} rendered rows
 */
function formatTableLines(section, width) {
  const headers = section.headers || [];
  const rows = section.rows || [];
  const numCols = headers.length || (rows.length > 0 ? rows[0].length : 0);
  if (numCols === 0) return [];

  const separatorSpace = numCols + 1;
  const availableWidth = width - separatorSpace;
  const colWidth = Math.max(1, Math.floor(availableWidth / numCols));

  const padText = (text, w, align = 'left') => {
    const str = String(text ?? '');
    if (str.length > w) return str.slice(0, w);
    const padding = w - str.length;
    if (align === 'right') return ' '.repeat(padding) + str;
    return str + ' '.repeat(padding);
  };

  const separator = () => {
    let line = '+';
    for (let i = 0; i < numCols; i++) line += '-'.repeat(colWidth) + '+';
    return line;
  };

  const renderRow = (data) => {
    let row = '|';
    for (let i = 0; i < numCols; i++) {
      const cell = data[i] ?? '';
      const align = (i === numCols - 1 && cell !== '' && !isNaN(cell)) ? 'right' : 'left';
      row += padText(cell, colWidth, align) + '|';
    }
    return row;
  };

  const out = [separator()];
  if (headers.length > 0) {
    out.push(renderRow(headers));
    out.push(separator());
  }
  for (const row of rows) out.push(renderRow(row));
  out.push(separator());
  return out;
}
