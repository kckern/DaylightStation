/**
 * Printer Router - Bridge to new Hardware infrastructure
 *
 * This module provides backward-compatible routing while delegating
 * to the new ThermalPrinterAdapter in 2_adapters/hardware.
 *
 * @module routers/printer
 */

import express from 'express';
import moment from 'moment-timezone';
import { createLogger } from '../lib/logging/logger.js';
import { ThermalPrinterAdapter } from '../../src/2_adapters/hardware/thermal-printer/ThermalPrinterAdapter.mjs';
import { getSelectionsForPrint } from './gratitude.mjs';

const printerLogger = createLogger({ app: 'printer' });
const printerRouter = express.Router();

// Lazy-initialized adapter
let printerAdapter = null;

/**
 * Get or create printer adapter
 * @returns {ThermalPrinterAdapter}
 */
function getPrinterAdapter() {
  if (printerAdapter) return printerAdapter;

  printerAdapter = new ThermalPrinterAdapter({
    host: process.env.printer?.host,
    port: process.env.printer?.port || 9100,
    timeout: 5000,
    upsideDown: true
  }, { logger: printerLogger });

  printerLogger.info('printer.adapter.initialized');
  return printerAdapter;
}

// ============================================================================
// Info & Status Endpoints
// ============================================================================

printerRouter.get('/', (req, res) => {
  res.json({
    message: 'Thermal Printer API',
    status: 'success',
    endpoints: {
      'GET /': 'This help message',
      'GET /ping': 'Check if printer is reachable (TCP ping)',
      'POST /text': 'Print text with optional formatting',
      'POST /image': 'Print image from path or URL',
      'POST /receipt': 'Print receipt-style document',
      'POST /table/:width?': 'Print ASCII table with statistical data',
      'GET /canvas': 'Generate Prayer Card PNG preview',
      'GET /canvas/preview': 'Alias for /canvas',
      'GET /canvas/print': 'Generate Prayer Card and print',
      'GET /img/:filename': 'Find image file, convert to B&W and print',
      'POST /print': 'Print custom print job object',
      'GET /feed-button': 'Get current feed button status',
      'GET /feed-button/on': 'Enable the printer feed button',
      'GET /feed-button/off': 'Disable the printer feed button'
    }
  });
});

printerRouter.get('/ping', async (req, res) => {
  try {
    const result = await getPrinterAdapter().ping();
    const statusCode = result.success ? 200 : (result.configured ? 503 : 501);
    res.status(statusCode).json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// Printing Endpoints
// ============================================================================

printerRouter.post('/text', async (req, res) => {
  try {
    const { text, options = {} } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const printJob = getPrinterAdapter().createTextPrint(text, options);
    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? 'Text printed successfully' : 'Print failed',
      printJob
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.post('/image', async (req, res) => {
  try {
    const { path, options = {} } = req.body;
    const imgpath = path || `${process.env.path.img}/bw/logo.png`;

    const printJob = getPrinterAdapter().createImagePrint(imgpath, options);
    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? 'Image printed successfully' : 'Print failed',
      printJob
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.post('/receipt', async (req, res) => {
  try {
    const receiptData = req.body;
    if (!receiptData) {
      return res.status(400).json({ error: 'Receipt data is required' });
    }

    const printJob = getPrinterAdapter().createReceiptPrint(receiptData);
    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? 'Receipt printed successfully' : 'Print failed',
      printJob
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.post('/table/:width?', async (req, res) => {
  try {
    let tableData = req.body;
    const width = parseInt(req.params.width) || 48;

    if (!tableData || Object.keys(tableData).length === 0) {
      tableData = generateTestTableData(width);
    }

    if (!tableData.headers && (!tableData.rows || tableData.rows.length === 0)) {
      return res.status(400).json({
        error: 'Table must have either headers or rows with data'
      });
    }

    const tableConfig = { ...tableData, width };
    const printJob = getPrinterAdapter().createTablePrint(tableConfig);
    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? 'Table printed successfully' : 'Print failed',
      printJob,
      width,
      isTestData: !req.body || Object.keys(req.body).length === 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.post('/print', async (req, res) => {
  try {
    const printObject = req.body;
    if (!printObject || !printObject.items) {
      return res.status(400).json({ error: 'Valid print object with items array is required' });
    }

    const success = await getPrinterAdapter().print(printObject);

    res.json({
      success,
      message: success ? 'Print job completed successfully' : 'Print failed',
      printObject
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Feed Button Control
// ============================================================================

printerRouter.get('/feed-button', async (req, res) => {
  try {
    const printerStatus = await getPrinterAdapter().getStatus();
    if (!printerStatus.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to query printer status',
        details: printerStatus.error
      });
    }

    res.json({
      success: true,
      message: 'Printer status retrieved successfully',
      status: printerStatus
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

printerRouter.get('/feed-button/on', async (req, res) => {
  try {
    const printJob = getPrinterAdapter().setFeedButton(true);
    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? 'Feed button enabled successfully' : 'Feed button enable failed',
      enabled: true
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.get('/feed-button/off', async (req, res) => {
  try {
    const printJob = getPrinterAdapter().setFeedButton(false);
    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? 'Feed button disabled successfully' : 'Feed button disable failed',
      enabled: false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Canvas/Prayer Card Endpoints (legacy - uses canvas directly)
// ============================================================================

printerRouter.get('/canvas', async (req, res) => {
  try {
    const upsidedown = req.query.upsidedown === 'true';
    const { canvas } = await createCanvasTypographyDemo(upsidedown);

    const buffer = canvas.toBuffer('image/png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', 'inline; filename="prayer-card-preview.png"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.get('/canvas/preview', async (req, res) => {
  try {
    const upsidedown = req.query.upsidedown === 'true';
    const { canvas } = await createCanvasTypographyDemo(upsidedown);

    const buffer = canvas.toBuffer('image/png');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Disposition', 'inline; filename="prayer-card-preview.png"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

printerRouter.get('/canvas/print', async (req, res) => {
  try {
    const { canvas, width, height } = await createCanvasTypographyDemo(true);
    const buffer = canvas.toBuffer('image/png');
    const tempPath = `/tmp/canvas_demo_${Date.now()}.png`;
    const fs = await import('fs');

    fs.writeFileSync(tempPath, buffer);

    const printJob = getPrinterAdapter().createImagePrint(tempPath, {
      width,
      height,
      align: 'left',
      threshold: 128
    });

    const success = await getPrinterAdapter().print(printJob);

    try {
      fs.unlinkSync(tempPath);
    } catch (err) {
      printerLogger.warn('printer.temp_file_delete_failed', { error: err.message });
    }

    res.json({
      success,
      message: success ? 'Canvas printed successfully' : 'Print failed',
      dimensions: { width, height }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Image Printing
// ============================================================================

printerRouter.get('/img/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const imgDir = `${process.env.path?.img || './data/img'}/bw`;

    const extensions = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
    let foundPath = null;

    const fs = await import('fs');
    const path = await import('path');

    for (const ext of extensions) {
      const testPath = path.join(imgDir, `${filename}.${ext}`);
      if (fs.existsSync(testPath)) {
        foundPath = testPath;
        break;
      }
    }

    if (!foundPath) {
      const directPath = path.join(imgDir, filename);
      if (fs.existsSync(directPath)) {
        foundPath = directPath;
      }
    }

    if (!foundPath) {
      return res.status(404).json({
        error: `Image file '${filename}' not found in ${imgDir}`,
        searchedExtensions: extensions
      });
    }

    const printJob = getPrinterAdapter().createImagePrint(foundPath, {
      width: 575,
      align: 'center',
      threshold: 128
    });

    const success = await getPrinterAdapter().print(printJob);

    res.json({
      success,
      message: success ? `Image '${filename}' printed successfully` : 'Print failed',
      originalFile: foundPath
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

function generateTestTableData(width) {
  const randomValue = (min, max, decimals = 1) =>
    (Math.random() * (max - min) + min).toFixed(decimals);

  const isWide = width >= 60;

  if (isWide) {
    return {
      title: 'System Performance Dashboard',
      headers: ['Component', 'Status', 'Usage', 'Temperature', 'Load Avg'],
      rows: [
        ['CPU Core 1', 'OK', `${randomValue(10, 90)}%`, `${randomValue(35, 70)}°C`, randomValue(0.1, 2.0, 2)],
        ['CPU Core 2', 'OK', `${randomValue(10, 90)}%`, `${randomValue(35, 70)}°C`, randomValue(0.1, 2.0, 2)],
        ['Memory', 'OK', `${randomValue(40, 85)}%`, `${randomValue(30, 50)}°C`, `${randomValue(2, 16)} GB`],
        ['Disk SSD', 'OK', `${randomValue(20, 80)}%`, `${randomValue(25, 45)}°C`, `${randomValue(100, 999)} GB`],
        ['Network', 'OK', `${randomValue(5, 50)}%`, '-', `${randomValue(1, 100)} Mbps`],
        ['GPU', 'OK', `${randomValue(0, 95)}%`, `${randomValue(40, 80)}°C`, `${randomValue(0, 8)} GB`]
      ]
    };
  } else {
    return {
      title: 'Server Stats',
      headers: ['Metric', 'Value', 'Status'],
      rows: [
        ['CPU Usage', `${randomValue(15, 85)}%`, randomValue(15, 85) > 80 ? 'HIGH' : 'OK'],
        ['Memory', `${randomValue(4, 15)} GB`, randomValue(4, 15) > 12 ? 'HIGH' : 'OK'],
        ['Disk Space', `${randomValue(100, 900)} GB`, 'OK'],
        ['Network In', `${randomValue(1, 50)} Mbps`, 'OK'],
        ['Network Out', `${randomValue(1, 30)} Mbps`, 'OK'],
        ['Uptime', `${Math.floor(randomValue(1, 30))} days`, 'OK'],
        ['Processes', Math.floor(randomValue(50, 200)), 'OK'],
        ['Load Avg', randomValue(0.1, 3.0, 2), randomValue(0.1, 3.0) > 2.0 ? 'HIGH' : 'OK']
      ]
    };
  }
}

function selectItemsForPrint(items, count) {
  if (!items || items.length === 0) return [];
  if (items.length <= count) return [...items];

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const bucketDefs = [
    { maxDays: 7, weight: 50 },
    { maxDays: 14, weight: 20 },
    { maxDays: 30, weight: 15 },
    { maxDays: Infinity, weight: 15 }
  ];

  const buckets = bucketDefs.map(() => []);

  for (const item of items) {
    const itemDate = new Date(item.datetime).getTime();
    const ageMs = now - itemDate;
    const ageDays = ageMs / DAY_MS;

    let prevMax = 0;
    for (let i = 0; i < bucketDefs.length; i++) {
      if (ageDays >= prevMax && ageDays < bucketDefs[i].maxDays) {
        buckets[i].push(item);
        break;
      }
      prevMax = bucketDefs[i].maxDays;
    }
  }

  for (const bucket of buckets) {
    bucket.sort((a, b) => a.printCount - b.printCount);
  }

  function pickFromBucket(bucket) {
    if (bucket.length === 0) return null;
    const minPrintCount = bucket[0].printCount;
    const candidates = bucket.filter(i => i.printCount === minPrintCount);
    const idx = Math.floor(Math.random() * candidates.length);
    const picked = candidates[idx];
    const bucketIdx = bucket.findIndex(i => i.id === picked.id);
    if (bucketIdx !== -1) bucket.splice(bucketIdx, 1);
    return picked;
  }

  function getAvailableBuckets() {
    const available = [];
    const pendingWeights = [];

    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length > 0) {
        const totalWeight = bucketDefs[i].weight + pendingWeights.reduce((a, b) => a + b, 0);
        available.push({ bucketIndex: i, weight: totalWeight });
        pendingWeights.length = 0;
      } else {
        pendingWeights.push(bucketDefs[i].weight);
      }
    }

    if (pendingWeights.length > 0 && available.length > 0) {
      available[available.length - 1].weight += pendingWeights.reduce((a, b) => a + b, 0);
    }

    return available;
  }

  function selectBucketByWeight() {
    const available = getAvailableBuckets();
    if (available.length === 0) return -1;

    const totalWeight = available.reduce((sum, b) => sum + b.weight, 0);
    let random = Math.random() * totalWeight;

    for (const { bucketIndex, weight } of available) {
      random -= weight;
      if (random <= 0) return bucketIndex;
    }

    return available[available.length - 1].bucketIndex;
  }

  const selected = [];

  while (selected.length < count) {
    const bucketIndex = selectBucketByWeight();
    if (bucketIndex === -1) break;

    const picked = pickFromBucket(buckets[bucketIndex]);
    if (picked) {
      selected.push(picked);
    }
  }

  return selected;
}

async function createCanvasTypographyDemo(upsidedown = false) {
  const width = 580;
  const fontFamily = 'Roboto Condensed';
  const fontDir = process.env.path?.font || './backend/journalist/fonts/roboto-condensed';
  const fontPath = fontDir + '/roboto-condensed/RobotoCondensed-Regular.ttf';

  const selections = getSelectionsForPrint();

  const selectedGratitude = selections.gratitude.length > 0
    ? selectItemsForPrint(selections.gratitude, 2).map(s => ({
      id: s.id,
      text: s.item.text,
      displayName: s.displayName
    }))
    : [];

  const selectedHopes = selections.hopes.length > 0
    ? selectItemsForPrint(selections.hopes, 2).map(s => ({
      id: s.id,
      text: s.item.text,
      displayName: s.displayName
    }))
    : [];

  const { createCanvas, registerFont } = await import('canvas');

  try {
    registerFont(fontPath, { family: "Roboto Condensed" });
  } catch (fontError) {
    printerLogger.warn('printer.font_load_failed', { fontFamily, error: fontError.message });
  }

  const margin = 25;
  const lineHeight = 42;
  const itemMaxWidth = width - margin * 2 - 40;

  // Simplified height calculation
  const height = 600;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, width - 20, height - 20);

  let yPos = 5;

  ctx.fillStyle = '#000000';
  ctx.font = `bold 72px "${fontFamily}"`;
  const headerText = 'Prayer Card';
  const headerMetrics = ctx.measureText(headerText);
  const headerX = (width - headerMetrics.width) / 2;
  ctx.fillText(headerText, headerX, yPos);
  yPos += 85;

  ctx.font = `24px "${fontFamily}"`;
  const timestamp = moment().format('ddd, D MMM YYYY, h:mm A');
  const timestampMetrics = ctx.measureText(timestamp);
  const timestampX = (width - timestampMetrics.width) / 2;
  ctx.fillText(timestamp, timestampX, yPos);
  yPos += 35;

  ctx.fillRect(10, yPos, width - 20, 2);
  yPos += 15;

  // Gratitude section
  ctx.font = `bold 48px "${fontFamily}"`;
  ctx.fillText('Gratitude', margin, yPos + 10);
  yPos += 65;

  ctx.font = `36px "${fontFamily}"`;
  for (const item of selectedGratitude) {
    ctx.fillText(`• ${item.text}`, margin + 15, yPos);
    yPos += lineHeight;
  }

  yPos += 10;
  ctx.fillRect(10, yPos, width - 20, 2);
  yPos += 20;

  // Hopes section
  ctx.font = `bold 48px "${fontFamily}"`;
  ctx.fillText('Hopes', margin, yPos + 10);
  yPos += 65;

  ctx.font = `36px "${fontFamily}"`;
  for (const item of selectedHopes) {
    ctx.fillText(`• ${item.text}`, margin + 15, yPos);
    yPos += lineHeight;
  }

  if (upsidedown) {
    const flippedCanvas = createCanvas(width, height);
    const flippedCtx = flippedCanvas.getContext('2d');
    flippedCtx.translate(width, height);
    flippedCtx.scale(-1, -1);
    flippedCtx.drawImage(canvas, 0, 0);
    return { canvas: flippedCanvas, width, height };
  }

  return { canvas, width, height };
}

// Export for use by other modules
export { createCanvasTypographyDemo, selectItemsForPrint };
export default printerRouter;
