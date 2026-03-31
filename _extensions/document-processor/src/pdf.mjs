import { PDFDocument } from 'pdf-lib';

export async function buildPdf(jpgBuffers) {
  const doc = await PDFDocument.create();

  for (const buf of jpgBuffers) {
    const image = await doc.embedJpg(buf);
    const page = doc.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }

  return doc.save();
}

export function formatFilename(docDate, category, description, fallbackDate = null) {
  const date = docDate || fallbackDate || new Date().toISOString().slice(0, 10);
  const safeDesc = description.replace(/[/\\:*?"<>|]/g, '-').trim();
  return `${date} - ${category} - ${safeDesc}.pdf`;
}
