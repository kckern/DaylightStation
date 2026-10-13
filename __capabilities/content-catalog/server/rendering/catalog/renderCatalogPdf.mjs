import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';
import { Resvg } from '@resvg/resvg-js';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 36;
const COLS = 3;
const ROWS = 5;
const TITLE_HEIGHT = 50;
const CELL_GAP = 8;

export async function renderCatalogPdf({ title, svgs, logger = console }) {
  const doc = new PDFDocument({ size: 'letter', margin: 0 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const contentWidth = PAGE_WIDTH - 2 * MARGIN;
  const cellWidth = (contentWidth - (COLS - 1) * CELL_GAP) / COLS;
  const itemsPerPage = COLS * ROWS;
  const totalPages = Math.ceil(svgs.length / itemsPerPage);

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
    if (pageIndex > 0) doc.addPage();
    let gridTop = PAGE_HEIGHT - MARGIN;
    if (pageIndex === 0 && title) {
      doc.font('Helvetica-Bold').fontSize(24);
      const textWidth = doc.widthOfString(title);
      doc.text(title, (PAGE_WIDTH - textWidth) / 2, MARGIN, { lineBreak: false });
      gridTop -= TITLE_HEIGHT;
    }
    const gridHeight = gridTop - MARGIN;
    const cellHeight = (gridHeight - (ROWS - 1) * CELL_GAP) / ROWS;
    const startIndex = pageIndex * itemsPerPage;
    const pageSvgs = svgs.slice(startIndex, startIndex + itemsPerPage);
    for (let index = 0; index < pageSvgs.length; index++) {
      const x = MARGIN + (index % COLS) * (cellWidth + CELL_GAP);
      const y = PAGE_HEIGHT - gridTop + Math.floor(index / COLS) * (cellHeight + CELL_GAP);
      try {
        SVGtoPDF(doc, convertEmbeddedSvgsToPng(pageSvgs[index]), x, y, {
          width: cellWidth, height: cellHeight, preserveAspectRatio: 'xMidYMid meet',
        });
      } catch (err) {
        logger.warn?.('catalog.svg.embedFailed', { index: startIndex + index, error: err.message });
      }
    }
  }
  await new Promise((resolve) => { doc.on('end', resolve); doc.end(); });
  return Buffer.concat(chunks);
}

function convertEmbeddedSvgsToPng(svgText) {
  return svgText.replace(/href="data:image\/svg\+xml;base64,([^"]+)"/g, (match, encoded) => {
    try {
      const svg = Buffer.from(encoded, 'base64').toString('utf-8');
      const png = new Resvg(svg, { fitTo: { mode: 'width', value: 200 } }).render().asPng();
      return `href="data:image/png;base64,${Buffer.from(png).toString('base64')}"`;
    } catch { return match; }
  });
}
