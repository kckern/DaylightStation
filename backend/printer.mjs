import express from 'express';
import moment from 'moment-timezone';
import { thermalPrint, createTextPrint, createImagePrint, createReceiptPrint, createTablePrint, setFeedButton, queryPrinterStatus, testFeedButton } from './lib/thermalprint.mjs';
import { getSelectionsForPrint } from './gratitude.mjs';

const printerRouter = express.Router();

// Printer endpoints
printerRouter.get('/', (req, res) => {
    res.json({
        message: 'Thermal Printer API',
        status: 'success',
        endpoints: {
            'GET /': 'This help message',
            'POST /text': 'Print text with optional formatting',
            'POST /image': 'Print image from path or URL',
            'POST /receipt': 'Print receipt-style document',
            'POST /table/:width?': 'Print ASCII table with statistical data',
            'GET /canvas': 'Generate 550x1000px PNG with pixel-art text and lorem ipsum',
            'GET /canvas/print': 'Generate canvas content and send directly to thermal printer',
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

// Helper function to create canvas with Prayer Card layout
async function createCanvasTypographyDemo(upsidedown=false) {
    const width = 580;
    const height = 550;
    const fontFamily = 'Roboto Condensed';
    const fontDir = process.env.path?.font || './backend/journalist/fonts/roboto-condensed';
    const fontPath = fontDir + '/roboto-condensed/RobotoCondensed-Regular.ttf';
    
    // Get selections from gratitude data
    const selections = getSelectionsForPrint();
    
    // Fallback items if no selections
    const fallbackGratitudeItems = [
        'Family health and happiness',
        'Safe travels and journeys',
        'Meaningful friendships',
        'Daily bread and nourishment',
        'Peaceful moments of rest'
    ];

    const fallbackWishItems = [
        'Peace in troubled hearts',
        'Healing for the sick',
        'Comfort for those who mourn',
        'Guidance for lost souls',
        'Unity in divided communities'
    ];

    // Use selections if available, otherwise use fallback items
    const gratitudeTexts = selections.gratitude.length > 0 
        ? selections.gratitude.map(item => item.text)
        : fallbackGratitudeItems;
        
    const wishTexts = selections.hopes.length > 0 
        ? selections.hopes.map(item => item.text)
        : fallbackWishItems;

    // Function to get random items or take all if fewer than requested
    const getRandomItems = (items, count) => {
        if (items.length <= count) return items;
        const shuffled = [...items].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    };

    // Create canvas
    const { createCanvas, registerFont } = await import('canvas');
    
    // Register font
    try {
        registerFont(fontPath, { family: "Roboto Condensed" });
    } catch (fontError) {
        console.warn(`Could not load ${fontFamily} font:`, fontError.message);
    }
    
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
    
    const margin = 25;
    let yPos = 5;
    
    // Header section
    ctx.fillStyle = '#000000';
    ctx.font = `bold 72px "${fontFamily}"`; // 48 * 1.5 = 72
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
    
    // Calculate section heights
    const remainingHeight = height - yPos - 30; // 30 for bottom margin
    const sectionHeight = (remainingHeight - 20) / 2; // 20 for spacing between sections
    
    // Gratitude section
    const gratitudeStartY = yPos;
    const gratitudeSectionCenterY = gratitudeStartY + (sectionHeight / 2);
    
    // Calculate total content height for gratitude section
    const gratitudeContentHeight = 68 + (2 * 53); // header + 2 items (adjusted for larger fonts)
    const gratitudeContentStartY = gratitudeSectionCenterY - (gratitudeContentHeight / 2);
    
    // Gratitude header (vertically centered in section)
    ctx.font = `bold 48px "${fontFamily}"`; // 32 * 1.5 = 48
    ctx.fillText('Gratitude', margin, gratitudeContentStartY);
    let gratitudeItemsY = gratitudeContentStartY + 68; // adjusted for larger header font
    
    // Gratitude items
    ctx.font = `36px "${fontFamily}"`; // 24 * 1.5 = 36
    const selectedGratitude = getRandomItems(gratitudeTexts, 2);
    for (const item of selectedGratitude) {
        ctx.fillText(`• ${item}`, margin + 15, gratitudeItemsY);
        gratitudeItemsY += 53; // adjusted for larger font
    }
    
    // Middle divider - extends to frame borders
    const middleDividerY = gratitudeStartY + sectionHeight + 10;
    ctx.fillRect(10, middleDividerY, width - 20, 2);
    
    // Wishes section
    const wishesStartY = middleDividerY + 20;
    const wishesSectionCenterY = wishesStartY + (sectionHeight / 2);
    
    // Calculate total content height for wishes section
    const wishesContentHeight = 68 + (2 * 53); // header + 2 items (adjusted for larger fonts)
    const wishesContentStartY = wishesSectionCenterY - (wishesContentHeight / 2);
    
    // Wishes header (vertically centered in section)
    ctx.font = `bold 48px "${fontFamily}"`; // 32 * 1.5 = 48
    ctx.fillText('Hopes', margin, wishesContentStartY);
    let wishesItemsY = wishesContentStartY + 68; // adjusted for larger header font
    
    // Wishes items
    ctx.font = `36px "${fontFamily}"`; // 24 * 1.5 = 36
    const selectedWishes = getRandomItems(wishTexts, 2);
    for (const item of selectedWishes) {
        ctx.fillText(`• ${item}`, margin + 15, wishesItemsY);
        wishesItemsY += 53; // adjusted for larger font
    }

    // Flip canvas upside down if requested
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

// Canvas text rendering
printerRouter.get('/canvas', async (req, res) => {
    try {
        const { canvas } = await createCanvasTypographyDemo();
        
        // Convert to PNG buffer
        const buffer = canvas.toBuffer('image/png');
        
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Canvas print - generate canvas and send to thermal printer
printerRouter.get('/canvas/print', async (req, res) => {
    try {
        const { canvas, width, height } = await createCanvasTypographyDemo(true);
        
        // Convert canvas to buffer and save as temporary file
        const buffer = canvas.toBuffer('image/png');
        const tempPath = `/tmp/canvas_demo_${Date.now()}.png`;
        const fs = await import('fs');
        //flip upside down
        
        fs.writeFileSync(tempPath, buffer);
        
        // Create print job using the canvas image - no resizing, send as-is
        const printJob = createImagePrint(tempPath, {
            width: width,      // Original canvas width (550px)
            height: height,    // Original canvas height (1000px)
            align: 'left',     // No centering, print as-is
            threshold: 128     // Standard threshold for black/white conversion
        });
        
        const success = await thermalPrint(printJob);
        
        // Clean up temp file
        try {
            fs.unlinkSync(tempPath);
        } catch (err) {
            console.warn('Could not delete temp file:', err.message);
        }
        
        res.json({
            success,
            message: success ? 'Canvas demo printed successfully' : 'Print failed',
            dimensions: {
                width: width,
                height: height
            },
            printJob
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
            console.warn('Could not delete temp file:', err.message);
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
            console.warn('Could not delete temp file:', err.message);
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

export default printerRouter;
