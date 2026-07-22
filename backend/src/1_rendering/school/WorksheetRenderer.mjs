/**
 * WorksheetRenderer — a quiz bank rendered as a printable worksheet PDF
 * (Letter, pdfkit). Rendering layer: pure presentation, no I/O beyond
 * producing bytes, no policy. The same bank that drives an on-screen quiz
 * becomes a paper worksheet, so a child can work away from the kiosk.
 *
 * Answers are NOT printed — this is the worksheet, not the key. Each item
 * type lays out its own answer space: multiple choice lists lettered
 * options; short-answer/cloze leave a rule; matching prints two columns to
 * connect.
 *
 * @module rendering/school/WorksheetRenderer
 */
import PDFDocument from 'pdfkit';

const PAGE = { width: 612, height: 792 }; // US Letter, 72dpi
const MARGIN = 54;
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN;

function drawHeader(doc, { title, studentName }) {
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#000')
    .text(title, MARGIN, MARGIN, { width: CONTENT_WIDTH });
  doc.moveDown(0.3);
  const y = doc.y;
  doc.font('Helvetica').fontSize(11).fillColor('#444');
  doc.text(`Name: ${studentName || '____________________'}`, MARGIN, y, { continued: false });
  doc.text('Date: ____________________', PAGE.width - MARGIN - 180, y, { width: 180, align: 'right' });
  doc.moveTo(MARGIN, doc.y + 6).lineTo(PAGE.width - MARGIN, doc.y + 6).strokeColor('#ccc').stroke();
  doc.moveDown(1);
  doc.fillColor('#000');
}

// Each renderer draws its item's answer region and returns nothing; the
// caller manages numbering and spacing. Kept small and type-switched so a new
// item type is one branch, mirroring the on-screen runner's item types.
function drawItem(doc, item, number) {
  const label = `${number}. `;
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000');
  const promptWidth = CONTENT_WIDTH - doc.widthOfString(label);
  const startY = doc.y;
  doc.text(label, MARGIN, startY, { continued: true, width: CONTENT_WIDTH });
  doc.font('Helvetica').text(item.prompt || '', { width: promptWidth });
  doc.moveDown(0.4);

  switch (item.type) {
    case 'multiple_choice': {
      const letters = 'ABCDEFGH';
      (item.choices || []).forEach((choice, i) => {
        doc.font('Helvetica').fontSize(11).fillColor('#222')
          .text(`   ${letters[i] || '•'}.  ${choice}`, { width: CONTENT_WIDTH });
      });
      doc.moveDown(0.3);
      break;
    }
    case 'matching': {
      const pairs = item.pairs || [];
      const lefts = pairs.map((p) => p.left);
      const rights = pairs.map((p) => p.right).slice().reverse(); // shuffle-ish: don't align answers
      const colY = doc.y;
      const colW = CONTENT_WIDTH / 2 - 10;
      doc.font('Helvetica').fontSize(11).fillColor('#222');
      lefts.forEach((l, i) => doc.text(`___  ${l}`, MARGIN + 12, colY + i * 18, { width: colW }));
      rights.forEach((r, i) => doc.text(`${'abcdefgh'[i] || '•'}.  ${r}`, MARGIN + colW + 24, colY + i * 18, { width: colW }));
      doc.y = colY + Math.max(lefts.length, rights.length) * 18 + 6;
      break;
    }
    case 'short_answer':
    case 'cloze':
    default: {
      // A ruled answer line (or two for longer prompts).
      const lineY = doc.y + 6;
      doc.moveTo(MARGIN + 12, lineY).lineTo(PAGE.width - MARGIN, lineY).strokeColor('#999').stroke();
      doc.y = lineY + 10;
      break;
    }
  }
  doc.moveDown(0.6);
}

/**
 * Render a bank to a worksheet PDF.
 *
 * @param {{title:string, items:Array}} bank - validated question bank
 * @param {{studentName?:string}} [opts]
 * @returns {Promise<{pdf:Buffer, pageCount:number}>}
 */
export function renderBankWorksheet(bank, { studentName = null } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'letter', margin: MARGIN, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('error', reject);

      drawHeader(doc, { title: bank.title || 'Worksheet', studentName });

      (bank.items || []).forEach((item, i) => {
        // Page-break guard: if the next item would start too low, break early.
        if (doc.y > PAGE.height - MARGIN - 90) doc.addPage();
        drawItem(doc, item, i + 1);
      });

      const pageCount = doc.bufferedPageRange().count;
      doc.on('end', () => resolve({ pdf: Buffer.concat(chunks), pageCount }));
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export default { renderBankWorksheet };
