import { createCanvas, registerFont, loadImage } from 'canvas';
import QRCode from 'qrcode';
import axios from './http.mjs';
import { createLogger } from './logging/logger.js';

const graphicsLogger = createLogger({
  source: 'backend',
  app: 'graphics'
});

/**
 * Register fonts for canvas text rendering (deferred until first use)
 */
let fontsRegistered = false;
const ensureFontsRegistered = () => {
  if (fontsRegistered) return;
  try {
    const fontDir = process.env.path?.font || process.env.FONT_DIR || './media/fonts';
    const fontRegularPath = fontDir + '/roboto-condensed/RobotoCondensed-Regular.ttf';
    const fontItalicPath = fontDir + '/roboto-condensed/RobotoCondensed-Italic.ttf';
    registerFont(fontRegularPath, { family: 'Roboto Condensed', style: 'normal', weight: 'normal' });
    registerFont(fontItalicPath, { family: 'Roboto Condensed', style: 'italic', weight: 'normal' });
    fontsRegistered = true;
  } catch (e) {
    graphicsLogger.warn('graphics.font.registration.failed', { error: e.message });
  }
};

/**
 * Generate a family card image with a circle and title text
 * @param {string} name - The name text to display
 * @param {object} options - Optional styling parameters
 * @returns {Canvas} Canvas object with the generated image
 */
export const generateFamilyCard = async (code = "KWCF-2MD", options = {}) => {
  // Fetch data from FamilySearch API
  let personData;
  try {
    graphicsLogger.info('Fetching family data', { code });
    const response = await axios.get(`https://ancestors.familysearch.org/service/tree/tree-data/published/persons/${code}`);
    personData = response.data;
  } catch (error) {
    graphicsLogger.error('Error fetching family search data', { message: error?.message, stack: error?.stack, code });
    // Create a canvas and draw an error message
    const canvas = createCanvas(options.width || 1000, options.height || 700);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff0000';
    ctx.font = '30px "Roboto Condensed"';
    ctx.textAlign = 'center';
    ctx.fillText(`Could not load data for ${code}.`, canvas.width / 2, canvas.height / 2);
    return canvas;
  }

  const {
    width = 1000,
    height = 800,
    backgroundColor = '#ffffff',
    textColor = '#333333',
    notes = 'Notes about this person can go here.',
    name: nameOverride,
    img: imgOverride,
    relation = "Brother John Doe's great grandfather"
  } = options;

  // Extract data from API response
  const name = nameOverride || personData.person?.name || 'Unknown Name';
  const dates = personData.person?.lifespan || 'Unknown Dates';
  const portraitUrl = imgOverride || personData.person?.portrait?.url || `https://cdn.pixabay.com/photo/2015/10/05/22/37/blank-profile-picture-973460_640.png`;

  // Create canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Set background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Calculate layout dimensions (all relative to canvas size)
  const margin = Math.min(width, height) * 0.04; // 4% of smaller dimension
  const circleWidth = width * 0.5; // 50% of canvas width
  const textPadding = width * 0.02; // 2% of canvas width

  // Draw circle flush left with padding (keep as perfect circle using smaller dimension)
  const maxCircleSize = Math.min(circleWidth - margin * 2, height * 0.5 - margin * 2);
  const circleRadius = maxCircleSize / 2;
  
  // Position circle flush left with padding, vertically centered in top half
  const circleCenterX = margin + circleRadius;
  const circleCenterY = (height * 0.5) / 2; // Vertically center in top half of canvas

  // Draw portrait image
  ctx.save();
  ctx.beginPath();
  ctx.arc(circleCenterX, circleCenterY, circleRadius, 0, 2 * Math.PI);
  ctx.clip();

  if (portraitUrl) {
    try {
      const portraitImage = await loadImage(portraitUrl);
      ctx.drawImage(portraitImage, circleCenterX - circleRadius, circleCenterY - circleRadius, circleRadius * 2, circleRadius * 2);
    } catch (imgError) {
      graphicsLogger.warn('Could not load portrait image', { message: imgError?.message, code, portraitUrl });
      // Draw a placeholder if image fails to load
      ctx.fillStyle = '#cccccc';
      ctx.fill();
    }
  } else {
    // Draw a placeholder if no image URL
    ctx.fillStyle = '#cccccc';
    ctx.fill();
  }


  ctx.restore();

  // Draw border for the circle
  ctx.beginPath();
  ctx.arc(circleCenterX, circleCenterY, circleRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Text area bounds (remaining space to the right of circle)
  const actualCircleWidth = (circleCenterX + circleRadius) + textPadding; // Actual space used by circle + padding
  const textAreaX = actualCircleWidth;
  const textAreaY = margin + textPadding;
  const textAreaWidth = width - actualCircleWidth - margin; // Fill remaining space to right edge
  
  // Calculate text area height - position in upper portion of canvas
  const upperPortionHeight = height * 0.5; // Use upper half of canvas for text/dates
  const datesHeight = height * 0.09; // 6% of canvas height
  const gapBetweenTextAndDates = height * 0.02; // 2% of canvas height
  
  // Text area height fits in upper portion
  const maxTextAreaBottom = upperPortionHeight - margin;
  const availableTextHeight = maxTextAreaBottom - textAreaY - datesHeight - gapBetweenTextAndDates;
  const textAreaHeight = Math.max(availableTextHeight, height * 0.1); // Minimum 10% height

  // Draw outline around text box for debugging
  // ctx.strokeStyle = '#cccccc';
  // ctx.lineWidth = Math.max(1, width * 0.001); // Scale line width
  // ctx.strokeRect(textAreaX, textAreaY, textAreaWidth, textAreaHeight);

  // Function to wrap text
  function wrapText(context, text, maxWidth, fontSize, { preventWidows } = {}) {
    const words = text.split(' ');
    if (words.length === 0) {
      return { lines: [], lineHeight: 0, totalHeight: 0 };
    }
    
    const lines = [];
    let currentLine = words[0] || '';

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const width = context.measureText(currentLine + ' ' + word).width;
      
      if (width < maxWidth) {
        currentLine += ' ' + word;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
    lines.push(currentLine);

    // Logic to prevent widows (single word on the last line)
    if (preventWidows && lines.length > 1) {
      const lastLine = lines[lines.length - 1];
      const lastLineWords = lastLine.split(' ');

      if (lastLineWords.length === 1) {
        const secondToLastLine = lines[lines.length - 2];
        const secondToLastLineWords = secondToLastLine.split(' ');
        
        if (secondToLastLineWords.length > 1) {
          // Move the last word from the second-to-last line to the last line
          const wordToMove = secondToLastLineWords.pop();
          lines[lines.length - 2] = secondToLastLineWords.join(' ');
          lines[lines.length - 1] = [wordToMove, lastLine].join(' ');
        }
      }
    }

    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    return { lines, lineHeight, totalHeight };
  }

  // Find appropriate font size for multiline text (max 3 lines)
  let currentFontSize = Math.min(width, height) * 0.2; // Start with 20% of smaller dimension
  let textBlock;
  const maxLines = 3;
  
  // First, ensure the longest word can fit
  const words = name.split(' ');
  const longestWord = words.reduce((longest, word) => word.length > longest.length ? word : longest, '');
  
  // Check if longest word fits at current font size, if not reduce font size
  ctx.font = `${currentFontSize}px "Roboto Condensed"`;
  let longestWordWidth = ctx.measureText(longestWord).width;
  while (longestWordWidth > textAreaWidth && currentFontSize > Math.min(width, height) * 0.012) {
    currentFontSize -= Math.max(1, width * 0.001);
    ctx.font = `${currentFontSize}px "Roboto Condensed"`;
    longestWordWidth = ctx.measureText(longestWord).width;
  }
  
  // Now check if full text fits with wrapping
  do {
    ctx.font = `${currentFontSize}px "Roboto Condensed"`;
    textBlock = wrapText(ctx, name, textAreaWidth, currentFontSize);
    
    // Check if it fits both in height and line count
    if (textBlock.lines.length <= maxLines && textBlock.totalHeight <= textAreaHeight) {
      break;
    }
    currentFontSize -= Math.max(1, width * 0.001); // Decrease proportionally
  } while (currentFontSize > Math.min(width, height) * 0.012); // Minimum 1.2% of smaller dimension

  // Draw multiline text (centered)
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  
  const { lines, lineHeight, totalHeight } = textBlock;
  const startY = textAreaY + (textAreaHeight - totalHeight) / 2; // Center vertically in text area
  const textCenterX = textAreaX + textAreaWidth / 2; // Center horizontally in text area

  lines.forEach((line, index) => {
    ctx.fillText(line, textCenterX, startY + index * lineHeight);
  });

  // Add dates text box below the main text
  const datesAreaX = textAreaX;
  const datesAreaY = textAreaY + textAreaHeight + gapBetweenTextAndDates;
  const datesAreaWidth = textAreaWidth;
  const datesAreaHeight = datesHeight;
  const datesText = dates; // Use parameter

  // Draw outline around dates box for debugging
  // ctx.strokeStyle = '#cccccc';
  // ctx.lineWidth = Math.max(1, width * 0.001);
  // ctx.strokeRect(datesAreaX, datesAreaY, datesAreaWidth, datesAreaHeight);

  // Draw dates text, sized to fill the height of the box and spaced to fill the width.
  const datesFontSize = datesAreaHeight * 0.7; // 70% of the box height
  ctx.font = `${datesFontSize}px "Roboto Condensed"`;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Calculate the width of the text with default spacing
  const textMetrics = ctx.measureText(datesText);
  const textWidth = textMetrics.width;

  // Calculate the required letter spacing to fill the width
  const availableWidth = datesAreaWidth * 0.9; // Use 90% of the area to avoid touching the edges
  if (textWidth < availableWidth && datesText.length > 1) {
    const totalSpacing = availableWidth - textWidth;
    const letterSpacing = totalSpacing / (datesText.length - 1);
    ctx.letterSpacing = `${letterSpacing}px`;
  } else {
    ctx.letterSpacing = '0px';
  }
  
  const datesCenterX = datesAreaX + datesAreaWidth / 2;
  const datesCenterY = datesAreaY + datesAreaHeight / 2;
  
  ctx.fillText(datesText, datesCenterX, datesCenterY);

  // Reset letter spacing for subsequent text
  ctx.letterSpacing = '0px';

  // Draw horizontal separator line
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Add two full-width text boxes at the bottom
  const quarterHeight = height / 4;
  const bottomMargin = Math.min(width, height) * 0.02; // 2% margin for spacing
  
  // Top notes box (3rd quarter of height, with margin at the bottom)
  const notesAreaX = 0;
  const notesAreaY = height - (2 * quarterHeight);
  const notesAreaWidth = width;
  const notesAreaHeight = quarterHeight - bottomMargin; // Leave space at the bottom
  const notesText = notes; // Use parameter
  
  // Find appropriate font size for notes (start with percentage of height)
  let notesFontSize = height * 0.1; // Start with 10% of canvas height
  
  // First, ensure the longest word in notes can fit
  const notesWords = notesText.split(' ');
  const longestNotesWord = notesWords.reduce((longest, word) => word.length > longest.length ? word : longest, '');
  const notesAvailableWidth = notesAreaWidth - (width * 0.04); // 4% margin
  
  ctx.font = `italic normal ${notesFontSize}px "Roboto Condensed"`;
  let longestNotesWordWidth = ctx.measureText(longestNotesWord).width;
  while (longestNotesWordWidth > notesAvailableWidth && notesFontSize > Math.min(width, height) * 0.012) {
    notesFontSize -= Math.max(1, height * 0.001);
    ctx.font = `italic normal ${notesFontSize}px "Roboto Condensed"`;
    longestNotesWordWidth = ctx.measureText(longestNotesWord).width;
  }
  
  // Now check if full text fits with wrapping
  let notesWrapped;
  do {
    ctx.font = `italic normal ${notesFontSize}px "Roboto Condensed"`;
    notesWrapped = wrapText(ctx, notesText, notesAvailableWidth, notesFontSize, { preventWidows: true });
    
    // Check if it fits in height
    if (notesWrapped.totalHeight <= notesAreaHeight - (height * 0.04)) {
      break;
    }
    notesFontSize -= Math.max(1, height * 0.001); // Decrease proportionally
  } while (notesFontSize > Math.min(width, height) * 0.012);
  
  // Draw notes text
  ctx.fillStyle = '#aaaaaa';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  
  const { lines: notesLines, lineHeight: notesLineHeight, totalHeight: totalNotesHeight } = notesWrapped;
  const notesStartY = notesAreaY + (notesAreaHeight - totalNotesHeight) / 2;
  const notesCenterX = notesAreaWidth / 2;

  // Draw outline around the notes text area
  /*
  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth = Math.max(1, width * 0.001);
  const notesBoxPadding = width * 0.02;
  ctx.strokeRect(
    notesAreaX + notesBoxPadding,
    notesAreaY,
    notesAreaWidth - (notesBoxPadding * 2),
    notesAreaHeight
  );
  */
  
  notesLines.forEach((line, index) => {
    ctx.fillText(line, notesCenterX, notesStartY + index * notesLineHeight);
  });
  
  // Bottom relation box (4th quarter of height) with #EEE background
  const relationAreaX = 0;
  const relationAreaY = height - quarterHeight;
  const relationAreaWidth = width;
  const relationAreaHeight = quarterHeight;
  const relationText = relation; // Use parameter
  
  // Fill background with #EEE
  ctx.fillStyle = '#eeeeee';
  ctx.fillRect(relationAreaX, relationAreaY, relationAreaWidth, relationAreaHeight);
  
  // Add QR code and ID text to the relation area
  const familySearchUrl = `https://ancestors.familysearch.org/en/${code}`;
  const qrPadding = Math.min(width, height) * 0.02; // 2% padding
  
  // Calculate maximum QR size that fits in relation area
  const availableQRWidth = relationAreaWidth * 0.3; // Use 30% of relation area width
  const availableQRHeight = relationAreaHeight - (qrPadding * 2); // Account for vertical padding
  const maxQRFromShortestSide = Math.min(width, height) * 0.25; // 25% of shortest side
  
  // Use the smallest of the constraints to ensure it fits
  const qrBoxSize = Math.min(availableQRWidth, availableQRHeight * 0.8, maxQRFromShortestSide); // Leave 20% for ID text
  const idTextHeight = qrBoxSize * 0.15; // 15% of QR size for ID text
  const qrGap = qrBoxSize * 0.05; // 5% gap between QR and ID text
  
  // Position QR code on left side of relation area, vertically centered
  const qrTotalHeight = qrBoxSize + qrGap + idTextHeight;
  const qrStartY = relationAreaY + (relationAreaHeight - qrTotalHeight) / 2;
  const qrBoxX = relationAreaX + qrPadding;
  const qrBoxY = qrStartY;
  
  // Generate QR code as buffer
  const qrCodeBuffer = await QRCode.toBuffer(familySearchUrl, {
    width: qrBoxSize,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
  
  // Create a temporary canvas for the QR code
  const qrCanvas = createCanvas(qrBoxSize, qrBoxSize);
  const qrCtx = qrCanvas.getContext('2d');
  
  // Create image from buffer
  const qrImage = await loadImage(qrCodeBuffer);
  
  // Draw QR code on temporary canvas
  qrCtx.drawImage(qrImage, 0, 0, qrBoxSize, qrBoxSize);
  
  // Draw the QR canvas onto main canvas
  ctx.drawImage(qrCanvas, qrBoxX, qrBoxY);
  
  // Draw ID text below QR code, spaced to 80% of QR width
  const idTextY = qrBoxY + qrBoxSize + qrGap;
  const idFontSize = idTextHeight * 1; // Use 80% of available height for the font
  ctx.font = `${idFontSize}px "Roboto Condensed"`;
  ctx.fillStyle = '#666666';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const targetIdTextWidth = qrBoxSize * 1;
  const idCodeMetrics = ctx.measureText(code);
  
  if (idCodeMetrics.width < targetIdTextWidth && code.length > 1) {
    const totalSpacing = targetIdTextWidth - idCodeMetrics.width;
    const letterSpacing = totalSpacing / (code.length - 1);
    ctx.letterSpacing = `${letterSpacing}px`;
  } else {
    ctx.letterSpacing = '0px';
  }

  const idTextCenterX = qrBoxX + qrBoxSize / 2;
  ctx.fillText(code, idTextCenterX, idTextY);

  // Reset letter spacing
  ctx.letterSpacing = '0px';

  // --- Relation Text Box Calculation and Drawing ---

  // 1. Define the geometry of the box for the relation text.
  // It sits to the right of the QR code and has the same height.
  const relationBoxPadding = Math.min(width, height) * 0.01;
  const relationBoxX = qrBoxX + qrBoxSize + qrPadding;
  const relationBoxWidth = relationAreaWidth - relationBoxX - qrPadding;
  const relationBoxY = qrBoxY;
  const relationBoxHeight = qrBoxSize;

  // 2. Define the available area for the text *inside* the box.
  const availableRelationTextWidth = relationBoxWidth - (relationBoxPadding * 2);
  const availableRelationTextHeight = relationBoxHeight - (relationBoxPadding * 2);

  // 3. Dynamically find the largest font size that allows the text to fit within 2 lines.
  let relationFontSize = Math.min(width, height) * 0.08; // Start with a larger size
  ctx.font = `${relationFontSize}px "Roboto Condensed"`;

  // Reduce font size until it fits width, height, and max lines constraints
  const relationWords = relation.split(' ');
  const longestRelationWord = relationWords.reduce((longest, word) => word.length > longest.length ? word : longest, '');
  
  let wrapped;
  do {
    ctx.font = `${relationFontSize}px "Roboto Condensed"`;
    const longestWordWidth = ctx.measureText(longestRelationWord).width;
    wrapped = wrapText(ctx, relationText, availableRelationTextWidth, relationFontSize, { preventWidows: true });

    if (longestWordWidth <= availableRelationTextWidth && wrapped.totalHeight <= availableRelationTextHeight && wrapped.lines.length <= 2) {
      break; // It fits
    }
    relationFontSize -= Math.max(1, height * 0.001);
  } while (relationFontSize > Math.min(width, height) * 0.012);

  const { lines: relationLines, lineHeight: relationLineHeight, totalHeight: totalRelationHeight } = wrapped;

  // 4. Draw the box outline (transparent background).
  // ctx.strokeStyle = '#999999'; // Grey outline
  // ctx.lineWidth = Math.max(1, width * 0.001);
  // ctx.strokeRect(relationBoxX, relationBoxY, relationBoxWidth, relationBoxHeight);

  // 5. Draw the text, vertically centered inside the box.
  ctx.fillStyle = '#999999'; // Grey text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  const relationTextStartY = relationBoxY + (relationBoxHeight - totalRelationHeight) / 2;
  const relationCenterX = relationBoxX + relationBoxWidth / 2;

  relationLines.forEach((line, index) => {
    ctx.fillText(line, relationCenterX, relationTextStartY + index * relationLineHeight);
  });

  // Draw dashed border just inside the canvas edge
  ctx.strokeStyle = '#dddddd';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]); // 5px dash, 5px gap
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.setLineDash([]); // Reset to solid line for future use

  return canvas;
};