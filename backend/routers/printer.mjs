import express from 'express';
import moment from 'moment-timezone';
import { thermalPrint, createTextPrint, createImagePrint, createReceiptPrint, createTablePrint, setFeedButton, queryPrinterStatus, testFeedButton, pingPrinter } from '../lib/thermalprint.mjs';
import { getSelectionsForPrint } from './gratitude.mjs';
import { createLogger } from '../lib/logging/logger.js';

const printerLogger = createLogger({ app: 'printer' });

const printerRouter = express.Router();

// Printer endpoints
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
            'GET /canvas': 'Generate Prayer Card PNG preview (does not track prints)',
            'GET /canvas/preview': 'Alias for /canvas - preview without tracking',
            'GET /canvas/print': 'Generate Prayer Card, send to printer (no tracking)',
            'GET /checkerboard/:width?': 'Print checkerboard pattern (width in squares, default 48)',
            'GET /img/:filename': 'Find image file, convert to B&W 575px wide and print',
            'POST /print': 'Print custom print job object',
            'GET /feed-button': 'Get current feed button status',
            'GET /feed-button/on': 'Enable the printer feed button',
            'GET /feed-button/off': 'Disable the printer feed button',
            'GET /feed-button/test': 'Test feed button functionality'
        }
    });
});

// Ping printer - check if reachable without sending any print data
printerRouter.get('/ping', async (req, res) => {
    try {
        const result = await pingPrinter();
        const statusCode = result.success ? 200 : (result.configured ? 503 : 501);
        res.status(statusCode).json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Print simple text
printerRouter.post('/text', async (req, res) => {
    try {
        const { text, options = {} } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        const printJob = createTextPrint(text, options);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Text printed successfully' : 'Print failed',
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print image
printerRouter.post('/image', async (req, res) => {
    try {
        const { path, options = {} } = req.body;

        const imgpath = path || `${process.env.path.img}/bw/logo.png`;

        const printJob = createImagePrint(imgpath, options);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Image printed successfully' : 'Print failed',
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print receipt
printerRouter.post('/receipt', async (req, res) => {
    try {
        const receiptData = req.body;
        
        if (!receiptData) {
            return res.status(400).json({ error: 'Receipt data is required' });
        }
        
        const printJob = createReceiptPrint(receiptData);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Receipt printed successfully' : 'Print failed',
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print table
printerRouter.post('/table/:width?', async (req, res) => {
    try {
        let tableData = req.body;
        const width = parseInt(req.params.width) || 48; // Default width
        
        // Generate test data if no data provided
        if (!tableData || Object.keys(tableData).length === 0) {
            const testData = generateTestTableData(width);
            tableData = testData;
        }
        
        // Validate required table structure
        if (!tableData.headers && (!tableData.rows || tableData.rows.length === 0)) {
            return res.status(400).json({ 
                error: 'Table must have either headers or rows with data' 
            });
        }
        
        // Add width to table configuration
        const tableConfig = {
            ...tableData,
            width: width
        };
        
        const printJob = createTablePrint(tableConfig);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Table printed successfully' : 'Print failed',
            printJob,
            width: width,
            isTestData: !req.body || Object.keys(req.body).length === 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Helper function to generate test table data
function generateTestTableData(width) {
    const currentTime = new Date();
    const randomValue = (min, max, decimals = 1) => 
        (Math.random() * (max - min) + min).toFixed(decimals);
    
    // Determine table complexity based on width
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
                ['씨피유 Usage', `${randomValue(15, 85)}%`, randomValue(15, 85) > 80 ? 'HIGH' : 'OK'],
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

/**
 * Select items for printing using recency-weighted randomization
 * 
 * Recency buckets (non-inclusive boundaries):
 *   50% - submitted in last 7 days
 *   20% - submitted 7-14 days ago
 *   15% - submitted 14-30 days ago
 *   15% - submitted over 30 days ago
 * 
 * Within each bucket, prioritize by printCount (lowest first)
 * If a bucket is empty, merge to nearest available bucket
 * 
 * @param {Array} items - Array of selection objects with printCount and datetime
 * @param {number} count - Number of items to select
 * @returns {Array} Selected items
 */
function selectItemsForPrint(items, count) {
    if (!items || items.length === 0) return [];
    if (items.length <= count) return [...items];
    
    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    
    // Define recency buckets with weights
    const bucketDefs = [
        { maxDays: 7, weight: 50 },    // 0-7 days: 50%
        { maxDays: 14, weight: 20 },   // 7-14 days: 20%
        { maxDays: 30, weight: 15 },   // 14-30 days: 15%
        { maxDays: Infinity, weight: 15 } // 30+ days: 15%
    ];
    
    // Categorize items into buckets
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
    
    // Sort each bucket by printCount (ascending - least printed first)
    for (const bucket of buckets) {
        bucket.sort((a, b) => a.printCount - b.printCount);
    }
    
    /**
     * Pick one item from a bucket, prioritizing lowest printCount
     * Random selection within items of equal printCount
     */
    function pickFromBucket(bucket) {
        if (bucket.length === 0) return null;
        
        const minPrintCount = bucket[0].printCount; // Already sorted
        const candidates = bucket.filter(i => i.printCount === minPrintCount);
        const idx = Math.floor(Math.random() * candidates.length);
        const picked = candidates[idx];
        
        // Remove from bucket
        const bucketIdx = bucket.findIndex(i => i.id === picked.id);
        if (bucketIdx !== -1) bucket.splice(bucketIdx, 1);
        
        return picked;
    }
    
    /**
     * Get available bucket weights, merging empty buckets to nearest
     * Returns array of { bucketIndex, weight }
     */
    function getAvailableBuckets() {
        const available = [];
        const pendingWeights = [];
        
        for (let i = 0; i < buckets.length; i++) {
            if (buckets[i].length > 0) {
                // This bucket has items - add its weight plus any pending weights
                const totalWeight = bucketDefs[i].weight + pendingWeights.reduce((a, b) => a + b, 0);
                available.push({ bucketIndex: i, weight: totalWeight });
                pendingWeights.length = 0; // Clear pending
            } else {
                // Empty bucket - accumulate weight to merge with nearest
                pendingWeights.push(bucketDefs[i].weight);
            }
        }
        
        // If there are remaining pending weights (all later buckets empty),
        // add them to the last available bucket
        if (pendingWeights.length > 0 && available.length > 0) {
            available[available.length - 1].weight += pendingWeights.reduce((a, b) => a + b, 0);
        }
        
        return available;
    }
    
    /**
     * Select a bucket based on weights
     */
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
    
    // Select items
    const selected = [];
    
    while (selected.length < count) {
        const bucketIndex = selectBucketByWeight();
        if (bucketIndex === -1) break; // No items left
        
        const picked = pickFromBucket(buckets[bucketIndex]);
        if (picked) {
            selected.push(picked);
        }
    }
    
    return selected;
}

// Helper function to create canvas with Prayer Card layout
async function createCanvasTypographyDemo(upsidedown=false) {
    const width = 580;
    const fontFamily = 'Roboto Condensed';
    const fontDir = process.env.path?.font || './backend/journalist/fonts/roboto-condensed';
    const fontPath = fontDir + '/roboto-condensed/RobotoCondensed-Regular.ttf';
    
    // Get selections from gratitude data (enriched with displayName and printCount)
    const selections = getSelectionsForPrint();
    
    // Select 2 items per category using smart randomization (prioritizes unprinted)
    // If no selections available, leave empty (no fallbacks)
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

    // Track selected IDs for marking as printed later
    const selectedIds = {
        gratitude: selectedGratitude.filter(i => i.id).map(i => i.id),
        hopes: selectedHopes.filter(i => i.id).map(i => i.id)
    };

    // Create canvas
    const { createCanvas, registerFont } = await import('canvas');
    
    // Register font
    try {
        registerFont(fontPath, { family: "Roboto Condensed" });
    } catch (fontError) {
        printerLogger.warn('printer.font_load_failed', { fontFamily, error: fontError.message });
    }
    
    const margin = 25;
    const lineHeight = 42;
    const itemMaxWidth = width - margin * 2 - 40; // Available width for text
    
    // Helper function to wrap text - needed for height calculation
    function wrapText(text, maxWidth, font) {
        const tempCanvas = createCanvas(1, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.font = font;
        
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = tempCtx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }
    
    // Calculate height needed for an item (text + optional attribution line)
    function calculateItemHeight(item) {
        const lines = wrapText(item.text, itemMaxWidth, `36px "${fontFamily}"`);
        let height = lines.length * lineHeight;
        
        // Check if attribution needs its own line
        if (item.displayName && lines.length > 0) {
            const tempCanvas = createCanvas(1, 1);
            const tempCtx = tempCanvas.getContext('2d');
            
            tempCtx.font = `36px "${fontFamily}"`;
            const lastLineWidth = tempCtx.measureText(lines[lines.length - 1]).width;
            
            tempCtx.font = `24px "${fontFamily}"`;
            const attrWidth = tempCtx.measureText(`(${item.displayName})`).width;
            
            // If attribution doesn't fit on last line, add extra height
            if (margin + 40 + lastLineWidth + 10 + attrWidth > width - margin) {
                height += lineHeight * 0.7;
            }
        }
        
        return height;
    }
    
    // Calculate total dynamic height
    const headerHeight = 85 + 35 + 15; // Title + timestamp + divider
    const sectionHeaderHeight = 65; // "Gratitude" / "Hopes" headers
    const sectionPadding = 20;
    const dividerHeight = 25;
    const bottomMargin = 30;
    
    let gratitudeContentHeight = sectionHeaderHeight;
    for (const item of selectedGratitude) {
        gratitudeContentHeight += calculateItemHeight(item);
    }
    if (selectedGratitude.length === 0) {
        gratitudeContentHeight += lineHeight; // Empty section placeholder
    }
    
    let hopesContentHeight = sectionHeaderHeight;
    for (const item of selectedHopes) {
        hopesContentHeight += calculateItemHeight(item);
    }
    if (selectedHopes.length === 0) {
        hopesContentHeight += lineHeight; // Empty section placeholder
    }
    
    // Dynamic height with minimum
    const calculatedHeight = headerHeight + gratitudeContentHeight + sectionPadding + dividerHeight + hopesContentHeight + sectionPadding + bottomMargin;
    const height = Math.max(450, calculatedHeight); // Minimum 450px
    
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    ctx.textBaseline = 'top';
    
    // Fill background with white
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    
    // Draw main border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    
    let yPos = 5;
    
    // Header section
    ctx.fillStyle = '#000000';
    ctx.font = `bold 72px "${fontFamily}"`;
    const headerText = 'Prayer Card';
    const headerMetrics = ctx.measureText(headerText);
    const headerX = (width - headerMetrics.width) / 2;
    ctx.fillText(headerText, headerX, yPos);
    yPos += 85;
    
    // Timestamp under header
    ctx.font = `24px "${fontFamily}"`;
    const timestamp = moment().format('ddd, D MMM YYYY, h:mm A');
    const timestampMetrics = ctx.measureText(timestamp);
    const timestampX = (width - timestampMetrics.width) / 2;
    ctx.fillText(timestamp, timestampX, yPos);
    yPos += 35;
    
    // Header divider line - extends to frame borders
    ctx.fillRect(10, yPos, width - 20, 2);
    yPos += 15;
    
    // Helper function to wrap text to fit within maxWidth (using main ctx)
    // Returns array of lines
    function wrapTextCtx(text, maxWidth) {
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const metrics = ctx.measureText(testLine);
            
            if (metrics.width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines;
    }
    
    // Helper function to draw an item with text wrapping and attribution
    // Returns the Y position after drawing
    function drawItem(item, startY, indent, maxWidth) {
        const bulletIndent = indent;
        const textIndent = indent + 25; // Indent for wrapped lines (after bullet)
        const attributionGap = 10;
        
        // Draw bullet
        ctx.font = `36px "${fontFamily}"`;
        ctx.fillText('•', bulletIndent, startY);
        
        // Wrap the item text
        const lines = wrapTextCtx(item.text, maxWidth - 25); // Account for bullet width
        
        let currentY = startY;
        for (let i = 0; i < lines.length; i++) {
            ctx.font = `36px "${fontFamily}"`;
            ctx.fillText(lines[i], textIndent, currentY);
            
            // Add attribution on the last line if it fits, otherwise on new line
            if (i === lines.length - 1 && item.displayName) {
                const textWidth = ctx.measureText(lines[i]).width;
                ctx.font = `24px "${fontFamily}"`;
                const attrText = `(${item.displayName})`;
                const attrWidth = ctx.measureText(attrText).width;
                
                if (textIndent + textWidth + attributionGap + attrWidth < width - margin) {
                    // Fits on same line
                    ctx.fillText(attrText, textIndent + textWidth + attributionGap, currentY + 8);
                } else {
                    // Put on next line
                    currentY += lineHeight * 0.7;
                    ctx.fillText(attrText, textIndent, currentY + 8);
                }
            }
            
            if (i < lines.length - 1) {
                currentY += lineHeight;
            }
        }
        
        return currentY + lineHeight;
    }
    
    // Gratitude section
    ctx.font = `bold 48px "${fontFamily}"`;
    ctx.fillText('Gratitude', margin, yPos + 10);
    let itemsY = yPos + 65;
    
    // Gratitude items with text wrapping
    for (const item of selectedGratitude) {
        itemsY = drawItem(item, itemsY, margin + 15, itemMaxWidth);
    }
    
    // Middle divider - positioned after gratitude content
    itemsY += 10;
    ctx.fillRect(10, itemsY, width - 20, 2);
    itemsY += 20;
    
    // Hopes section
    ctx.font = `bold 48px "${fontFamily}"`;
    ctx.fillText('Hopes', margin, itemsY + 10);
    itemsY += 65;
    
    // Hopes items with text wrapping
    for (const item of selectedHopes) {
        itemsY = drawItem(item, itemsY, margin + 15, itemMaxWidth);
    }

    // Flip canvas upside down if requested
    if (upsidedown) {
        const flippedCanvas = createCanvas(width, height);
        const flippedCtx = flippedCanvas.getContext('2d');
        flippedCtx.translate(width, height);
        flippedCtx.scale(-1, -1);
        flippedCtx.drawImage(canvas, 0, 0);
        return { canvas: flippedCanvas, width, height, selectedIds };
    }
    
    return { canvas, width, height, selectedIds };
}

// Canvas preview - generate canvas image without marking items as printed
printerRouter.get('/canvas', async (req, res) => {
    try {
        const upsidedown = req.query.upsidedown === 'true';
        const { canvas } = await createCanvasTypographyDemo(upsidedown);
        
        // Convert to PNG buffer
        const buffer = canvas.toBuffer('image/png');
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Content-Disposition', 'inline; filename="prayer-card-preview.png"');
        res.send(buffer);
        
    } catch (error) {
        console.error('Canvas preview error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Canvas preview endpoint (alias for /canvas)
printerRouter.get('/canvas/preview', async (req, res) => {
    try {
        const upsidedown = req.query.upsidedown === 'true';
        const { canvas } = await createCanvasTypographyDemo(upsidedown);
        
        // Convert to PNG buffer
        const buffer = canvas.toBuffer('image/png');
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Content-Disposition', 'inline; filename="prayer-card-preview.png"');
        res.send(buffer);
        
    } catch (error) {
        console.error('Canvas preview error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Canvas print - generate canvas and send to thermal printer (does NOT mark items)
// For gratitude tracking, use /api/gratitude/card/print instead
printerRouter.get('/canvas/print', async (req, res) => {
    try {
        const { canvas, width, height } = await createCanvasTypographyDemo(true);
        
        // Convert canvas to buffer and save as temporary file
        const buffer = canvas.toBuffer('image/png');
        const tempPath = `/tmp/canvas_demo_${Date.now()}.png`;
        const fs = await import('fs');
        
        fs.writeFileSync(tempPath, buffer);
        
        // Create print job using the canvas image - no resizing, send as-is
        const printJob = createImagePrint(tempPath, {
            width: width,
            height: height,
            align: 'left',
            threshold: 128
        });
        
        const success = await thermalPrint(printJob);
        
        // Clean up temp file
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

//checker board
printerRouter.get('/checkerboard/:width?', async (req, res) => {
    try {

        const pixelWidth = parseInt(req.params.width) || 48; // Default width in squares
        const squareSize = 2; // Each square is exactly 2px as requested
        const width = pixelWidth / squareSize; // Calculate number of squares based on pixel width
        const totalWidth = pixelWidth * squareSize;
        const totalHeight = (pixelWidth/4) * squareSize; // Square checkerboard

        // Create checkerboard using Canvas with no antialiasing
        const { createCanvas } = await import('canvas');
        const canvas = createCanvas(totalWidth, totalHeight);
        const ctx = canvas.getContext('2d');
        
        // Disable antialiasing and image smoothing for crisp pixels
        ctx.imageSmoothingEnabled = false;
        ctx.antialias = 'none';
        
        // Fill the canvas with checkerboard pattern
        for (let row = 0; row < width; row++) {
            for (let col = 0; col < width; col++) {
                // Determine if this square should be black or white
                const isBlack = (row + col) % 2 === 0;
                ctx.fillStyle = isBlack ? '#000000' : '#FFFFFF';
                
                // Fill exactly 1px square (no fractional pixels)
                ctx.fillRect(col * squareSize, row * squareSize, squareSize, squareSize);
            }
        }
        
        // Convert canvas to buffer and create print job
        const buffer = canvas.toBuffer('image/png');
        
        // Create a temporary file path for the image
        const tempPath = `/tmp/checkerboard_${Date.now()}.png`;
        const fs = await import('fs');
        fs.writeFileSync(tempPath, buffer);
        
        // Create print job using the image
        const printJob = createImagePrint(tempPath, {
            width: totalWidth,
            height: totalHeight,
            align: 'center',
            threshold: 128
        });
        
        const success = await thermalPrint(printJob);
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempPath);
        } catch (err) {
            printerLogger.warn('printer.temp_file_delete_failed', { error: err.message });
        }
        
        res.json({
            success,
            message: success ? 'Checkerboard printed successfully' : 'Print failed',
            dimensions: {
                squares: width,
                pixelSize: totalWidth,
                squareSize: squareSize
            },
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});




// Print image by filename - converts to B&W and resizes to 575px wide
printerRouter.get('/img/:filename', async (req, res) => {
    try {
        const filename = req.params.filename;
        const imgDir = `${process.env.path?.img || './data/img'}/bw`;
        
        // Look for the file with various extensions
        const extensions = ['png', 'jpg', 'jpeg', 'webp', 'bmp'];
        let foundPath = null;
        
        const fs = await import('fs');
        const path = await import('path');
        
        // Try to find the file with any of the supported extensions
        for (const ext of extensions) {
            const testPath = path.join(imgDir, `${filename}.${ext}`);
            if (fs.existsSync(testPath)) {
                foundPath = testPath;
                break;
            }
        }
        
        // Also try the filename as provided (in case it already has extension)
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
        
        // Load and process the image with Canvas
        const { createCanvas, loadImage } = await import('canvas');
        
        // Load the original image
        const originalImage = await loadImage(foundPath);
        
        // Determine orientation and calculate dimensions
        const isWideImage = originalImage.width > originalImage.height;
        let targetWidth, targetHeight, canvas, ctx;
        
        if (isWideImage) {
            // For wide images: make height 575px and rotate 90 degrees
            const targetHeightForWide = 575;
            const aspectRatio = originalImage.width / originalImage.height;
            const targetWidthForWide = Math.round(targetHeightForWide * aspectRatio);
            
            // Create canvas for the rotated image (swap width/height for final orientation)
            canvas = createCanvas(targetHeightForWide, targetWidthForWide);
            ctx = canvas.getContext('2d');
            
            // Rotate 270 degrees clockwise and draw
            ctx.translate(0, targetWidthForWide);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(originalImage, 0, 0, targetWidthForWide, targetHeightForWide);
            
            // Update target dimensions for the rotated result
            targetWidth = targetHeightForWide;
            targetHeight = targetWidthForWide;
        } else {
            // For tall images: keep 575px wide (existing behavior)
            targetWidth = 575;
            const aspectRatio = originalImage.height / originalImage.width;
            targetHeight = Math.round(targetWidth * aspectRatio);
            
            canvas = createCanvas(targetWidth, targetHeight);
            ctx = canvas.getContext('2d');
            
            // Draw the image scaled to target size
            ctx.drawImage(originalImage, 0, 0, targetWidth, targetHeight);
        }
        
        // Get image data and convert to black and white
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;
        
        // Convert to grayscale and then to black/white
        for (let i = 0; i < data.length; i += 4) {
            // Calculate grayscale value using luminance formula
            const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
            
            // Convert to pure black or white using threshold
            const bw = gray > 128 ? 255 : 0;
            
            data[i] = bw;     // Red
            data[i + 1] = bw; // Green
            data[i + 2] = bw; // Blue
            // Alpha channel (data[i + 3]) remains unchanged
        }
        
        // Put the modified image data back to canvas
        ctx.putImageData(imageData, 0, 0);
        
        // Flip canvas upside down before printing
        const flippedCanvas = createCanvas(targetWidth, targetHeight);
        const flippedCtx = flippedCanvas.getContext('2d');
        flippedCtx.translate(targetWidth, targetHeight);
        flippedCtx.scale(-1, -1);
        flippedCtx.drawImage(canvas, 0, 0);
        
        // Convert flipped canvas to buffer and save as temporary file
        const buffer = flippedCanvas.toBuffer('image/png');
        const tempPath = `/tmp/processed_${Date.now()}_${path.basename(filename)}.png`;
        fs.writeFileSync(tempPath, buffer);
        
        // Create print job using the processed image
        const printJob = createImagePrint(tempPath, {
            width: targetWidth,
            height: targetHeight,
            align: 'center',
            threshold: 128
        });
        
        const success = await thermalPrint(printJob);
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempPath);
        } catch (err) {
            printerLogger.warn('printer.temp_file_delete_failed', { error: err.message });
        }
        
        res.json({
            success,
            message: success ? `Image '${filename}' printed successfully` : 'Print failed',
            originalFile: foundPath,
            orientation: isWideImage ? 'wide (rotated 90°)' : 'tall',
            dimensions: {
                original: { width: originalImage.width, height: originalImage.height },
                processed: { width: targetWidth, height: targetHeight }
            },
            printJob
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Feed button status
printerRouter.get('/feed-button', async (req, res) => {
    try {
        // Query actual printer status
        const printerStatus = await queryPrinterStatus();
        
        if (!printerStatus.success) {
            return res.status(500).json({
                success: false,
                error: 'Failed to query printer status',
                details: printerStatus.error,
                fallback: {
                    message: 'Feed Button Control API',
                    endpoints: {
                        'GET /feed-button': 'Get printer status including feed button state',
                        'GET /feed-button/on': 'Enable the printer feed button',
                        'GET /feed-button/off': 'Disable the printer feed button'
                    }
                }
            });
        }
        
        res.json({
            success: true,
            message: 'Printer status retrieved successfully',
            status: {
                online: printerStatus.online,
                feedButtonEnabled: printerStatus.feedButtonEnabled,
                paperPresent: printerStatus.paperPresent,
                coverOpen: printerStatus.coverOpen,
                errors: printerStatus.errors,
                timestamp: printerStatus.timestamp,
                note: printerStatus.note
            },
            endpoints: {
                'GET /feed-button': 'Get printer status including feed button state',
                'GET /feed-button/on': 'Enable the printer feed button',
                'GET /feed-button/off': 'Disable the printer feed button'
            },
            usage: {
                enable: 'GET /printer/feed-button/on',
                disable: 'GET /printer/feed-button/off'
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: 'Status query failed', 
            details: error.message,
            fallback: {
                message: 'Feed Button Control API',
                endpoints: {
                    'GET /feed-button': 'Get printer status including feed button state',
                    'GET /feed-button/on': 'Enable the printer feed button',
                    'GET /feed-button/off': 'Disable the printer feed button'
                }
            }
        });
    }
});

// Control feed button - Enable
printerRouter.get('/feed-button/on', async (req, res) => {
    try {
        const printJob = setFeedButton(true);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success 
                ? 'Feed button enabled successfully'
                : 'Feed button enable failed',
            enabled: true,
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Control feed button - Disable
printerRouter.get('/feed-button/off', async (req, res) => {
    try {
        const printJob = setFeedButton(false);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success 
                ? 'Feed button disabled successfully'
                : 'Feed button disable failed',
            enabled: false,
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test feed button functionality
printerRouter.get('/feed-button/test', async (req, res) => {
    try {
        const testResult = await testFeedButton();
        
        res.json({
            ...testResult,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            success: false,
            error: 'Feed button test failed', 
            details: error.message 
        });
    }
});

// Print custom job
printerRouter.post('/print', async (req, res) => {
    try {
        const printObject = req.body;
        
        if (!printObject || !printObject.items) {
            return res.status(400).json({ error: 'Valid print object with items array is required' });
        }
        
        const success = await thermalPrint(printObject);
        
        res.json({
            success,
            message: success ? 'Print job completed successfully' : 'Print failed',
            printObject
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Export canvas generation for use by other modules
export { createCanvasTypographyDemo, selectItemsForPrint };

export default printerRouter;
