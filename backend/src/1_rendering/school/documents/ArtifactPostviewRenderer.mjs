import PDFDocument from 'pdfkit';
import { createCanvas, DOMMatrix, ImageData, Path2D, DOMPoint } from '@napi-rs/canvas';

/**
 * PDF.js NEEDS A BROWSER'S CANVAS GLOBALS, AND CANNOT FIND THEM HERE.
 *
 * pdf.mjs polyfills `DOMMatrix`/`ImageData`/`Path2D` by requiring
 * `@napi-rs/canvas` through `process.getBuiltinModule` — added in Node 22.3,
 * absent from the Node 20 the container runs. So its polyfill block warned
 * "Cannot access the `require` function", left every global undefined, and the
 * first `constructPath` threw `Path2D is not defined`. The thumbnail route
 * catches a render failure and answers 404 by design (a corrupt PDF is a
 * missing view, not a server fault), so the failure surfaced only as the
 * words "No preview" under every worksheet on the dashboard — for years,
 * silently, on every PDF in the system.
 *
 * We do the polyfill ourselves, from the same package pdf.mjs would have
 * used, at import time — before anything can `await import` pdf.mjs below.
 *
 * AND WE RASTERIZE WITH THAT SAME CANVAS. Mixing implementations is the
 * second half of the trap: hand node-canvas a `Path2D` built by
 * `@napi-rs/canvas` and it neither draws it nor complains — the render
 * "succeeds" and returns a blank page (1.4KB of white for a full worksheet,
 * against 40KB when the two agree). One canvas, both jobs.
 */
for (const [name, value] of Object.entries({ DOMMatrix, ImageData, Path2D, DOMPoint })) {
  if (!globalThis[name] && value) globalThis[name] = value;
}

/**
 * Rasterize the exact issued PDF and overlay the evidence the lifecycle can
 * actually prove. Physical OMR supplies interpreted marks, not scan images;
 * this renderer therefore labels missed item ids and corrections instead of
 * fabricating photographed handwriting.
 */
export function createArtifactPostviewRenderer() {
  return async function renderArtifactPostview({ originalPdf, session }) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const source = await pdfjs.getDocument({ data: new Uint8Array(originalPdf) }).promise;
    try {
      const pages = [];
      for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber += 1) {
        // eslint-disable-next-line no-await-in-loop
        const page = await source.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        // eslint-disable-next-line no-await-in-loop
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        pages.push({ png: canvas.toBuffer('image/png'), width: viewport.width / 1.5, height: viewport.height / 1.5 });
      }
      return await compose(pages, session);
    } finally {
      await source.destroy();
    }
  };
}

/** Render the first page of an issued PDF for a non-mutating history preview. */
export async function renderPdfFirstPagePng(originalPdf, { width = 320 } = {}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const source = await pdfjs.getDocument({ data: new Uint8Array(originalPdf) }).promise;
  try {
    const page = await source.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas.toBuffer('image/png');
  } finally {
    await source.destroy();
  }
}

function compose(pages, session) {
  return new Promise((resolve, reject) => {
    const out = new PDFDocument({ autoFirstPage: false, margin: 0, info: { CreationDate: new Date('2000-01-01T00:00:00Z') } });
    const chunks = [];
    out.on('data', (chunk) => chunks.push(chunk));
    out.on('error', reject);
    out.on('end', () => resolve({ pdf: Buffer.concat(chunks), pageCount: pages.length }));
    pages.forEach((page, index) => {
      out.addPage({ size: [page.width, page.height], margin: 0 });
      out.image(page.png, 0, 0, { width: page.width, height: page.height });
      if (index === 0) drawEvidenceOverlay(out, session?.state ?? session ?? {}, page.width);
    });
    out.end();
  });
}

function drawEvidenceOverlay(doc, state, pageWidth) {
  const machine = state.machineGrade;
  const effective = state.gradedPercent;
  const active = [...(state.gradeAdjustments ?? [])].reverse().find((row) => !row.retracted);
  const missed = state.missedItemIds ?? [];
  const lines = [
    'POSTVIEW · interpreted evidence',
    `Machine grade: ${machine?.percent ?? '—'}%`,
    `Effective grade: ${effective ?? '—'}%`,
    `Outcome: ${state.outcome?.result ?? 'not recorded'}`,
    `Missed items: ${missed.length ? missed.join(', ') : 'none recorded'}`,
    ...(active ? [`Correction: ${active.reason}`, `By ${active.adjustedBy} · ${String(active.at).slice(0, 10)}`] : []),
  ];
  const width = Math.min(250, pageWidth - 36);
  const x = pageWidth - width - 18;
  const height = 26 + lines.length * 13;
  doc.save().roundedRect(x, 18, width, height, 6).fillOpacity(0.92).fill('#fff8d8')
    .fillOpacity(1).strokeColor('#8a6d00').lineWidth(1).stroke();
  lines.forEach((line, index) => {
    doc.fillColor(index === 0 ? '#5a4300' : '#222').font(index === 0 ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(index === 0 ? 9 : 8).text(line, x + 10, 28 + index * 13, { width: width - 20, lineBreak: false, ellipsis: true });
  });
  doc.restore();
}

export default createArtifactPostviewRenderer;
