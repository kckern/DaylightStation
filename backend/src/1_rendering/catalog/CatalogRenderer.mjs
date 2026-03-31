/**
 * Catalog PDF Renderer
 *
 * Lays out PNG images in a 3x5 grid on US Letter pages with a title header.
 *
 * @module rendering/catalog/CatalogRenderer
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const PAGE_WIDTH = 612;   // US Letter width in points
const PAGE_HEIGHT = 792;  // US Letter height in points
const MARGIN = 36;        // 0.5 inch margins
const COLS = 3;
const ROWS = 5;
const TITLE_HEIGHT = 50;
const CELL_GAP = 8;

/**
 * @returns {{ render: Function }}
 */
export function createCatalogRenderer() {
  return { render };
}

/**
 * @param {Object} params
 * @param {string} params.title - Catalog title (displayed on first page)
 * @param {Buffer[]} params.images - Array of PNG buffers
 * @returns {Promise<Uint8Array>} PDF bytes
 */
async function render({ title, images }) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const contentWidth = PAGE_WIDTH - 2 * MARGIN;
  const cellWidth = (contentWidth - (COLS - 1) * CELL_GAP) / COLS;

  const itemsPerPage = COLS * ROWS;
  const totalPages = Math.ceil(images.length / itemsPerPage);

  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isFirstPage = pageIdx === 0;

    // Title on first page
    let gridTop = PAGE_HEIGHT - MARGIN;
    if (isFirstPage && title) {
      const fontSize = 24;
      const textWidth = font.widthOfTextAtSize(title, fontSize);
      page.drawText(title, {
        x: (PAGE_WIDTH - textWidth) / 2,
        y: gridTop - fontSize,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });
      gridTop -= TITLE_HEIGHT;
    }

    const gridHeight = gridTop - MARGIN;
    const cellHeight = (gridHeight - (ROWS - 1) * CELL_GAP) / ROWS;

    const startIdx = pageIdx * itemsPerPage;
    const pageImages = images.slice(startIdx, startIdx + itemsPerPage);

    for (let i = 0; i < pageImages.length; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);

      const x = MARGIN + col * (cellWidth + CELL_GAP);
      const y = gridTop - (row + 1) * cellHeight - row * CELL_GAP;

      try {
        const pngImage = await doc.embedPng(pageImages[i]);
        const aspect = pngImage.width / pngImage.height;

        // Fit image within cell, maintaining aspect ratio
        let drawWidth = cellWidth;
        let drawHeight = cellWidth / aspect;
        if (drawHeight > cellHeight) {
          drawHeight = cellHeight;
          drawWidth = cellHeight * aspect;
        }

        // Center within cell
        const offsetX = (cellWidth - drawWidth) / 2;
        const offsetY = (cellHeight - drawHeight) / 2;

        page.drawImage(pngImage, {
          x: x + offsetX,
          y: y + offsetY,
          width: drawWidth,
          height: drawHeight,
        });
      } catch (err) {
        // Skip images that fail to embed
      }
    }
  }

  return doc.save();
}
