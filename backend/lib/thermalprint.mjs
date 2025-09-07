import escpos from 'escpos';
import Network from 'escpos-network';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import yaml from 'js-yaml';
import { saveFile } from './io.mjs';

// Printer logging utility
const printerLog = {
    info: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: 'INFO',
            message,
            data
        };
        printerLog._writeLog(logEntry);
    },
    error: (message, error = null) => {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: 'ERROR',
            message,
            error: error ? error.toString() : null
        };
        printerLog._writeLog(logEntry);
    },
    warn: (message, data = null) => {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: 'WARN',
            message,
            data
        };
        printerLog._writeLog(logEntry);
    },
    jobStart: (config, itemCount) => {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: 'JOB_START',
            message: 'Print job initiated',
            config: {
                target: `${config.ip}:${config.port}`,
                itemCount,
                upsideDown: config.upsideDown,
                timeout: config.timeout
            }
        };
        printerLog._writeLog(logEntry);
    },
    jobComplete: (success, duration) => {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level: 'JOB_COMPLETE',
            message: 'Print job finished',
            success,
            duration: `${duration}ms`
        };
        printerLog._writeLog(logEntry);
    },
    dataPreview: (commands, description = '') => {
        const timestamp = new Date().toISOString();
        const preview = commands.slice(0, 50).toString('hex');
        const logEntry = {
            timestamp,
            level: 'DATA_PREVIEW',
            message: description || 'Data sent to printer',
            size: commands.length,
            preview: `${preview}...`
        };
        printerLog._writeLog(logEntry);
    },
    _writeLog: (logEntry) => {
        try {
            const date = new Date().toISOString().split('T')[0];
            const logPath = `logs/printer/${date}`;
            
            // Load existing logs for the day or create empty array
            let dailyLogs = [];
            try {
                const existingFile = fs.readFileSync(`${process.env.path.data}/${logPath}.yaml`, 'utf8');
                const existingData = yaml.load(existingFile);
                if (Array.isArray(existingData)) {
                    dailyLogs = existingData;
                }
            } catch (e) {
                // File doesn't exist or is invalid, start fresh
            }
            
            // Add new log entry
            dailyLogs.push(logEntry);
            
            // Keep only last 1000 entries per day to prevent file bloat
            if (dailyLogs.length > 1000) {
                dailyLogs = dailyLogs.slice(-1000);
            }
            
            // Save updated logs
            saveFile(logPath, dailyLogs);
        } catch (error) {
            // Fallback to console if file logging fails
            console.error('Printer log write failed:', error);
            console.log('PRINTER_LOG:', logEntry);
        }
    }
};

// Default thermal printer configuration
const DEFAULT_CONFIG = {
    ip: process.env.printer?.host || null,
    port: process.env.printer?.port || 9100,
    timeout: 5000,
    encoding: 'utf8',
    upsideDown: true
};

/**
 * Main thermal print function
 * @param {Object} printObject - Configuration object for printing
 * @returns {Promise<boolean>} - Success or failure
 * 
 * printObject structure:
 * {
 *   config?: { ip?, port?, timeout?, encoding?, upsideDown? },
 *   items: [
 *     {
 *       type: 'text' | 'image' | 'barcode' | 'line' | 'space' | 'cut',
 *       content?: string | Buffer,
 *       align?: 'left' | 'center' | 'right',
 *       size?: { width: number, height: number },
 *       font?: 'a' | 'b',
 *       style?: { bold?: boolean, underline?: boolean, invert?: boolean },
 *       encoding?: string,
 *       // For images:
 *       path?: string,
 *       width?: number,
 *       height?: number,
 *       threshold?: number,
 *       // For barcodes:
 *       format?: 'CODE128' | 'EAN13' | 'EAN8' | 'UPC',
 *       barcodeHeight?: number,
 *       // For spacing:
 *       lines?: number
 *     }
 *   ],
 *   footer?: {
 *     paddingLines?: number,
 *     autoCut?: boolean
 *   }
 * }
 */
export async function thermalPrint(printObject) {
    const startTime = Date.now();
    
    try {
        // Validate input
        if (!printObject || !printObject.items || !Array.isArray(printObject.items)) {
            printerLog.error('Invalid printObject: must have items array');
            return false;
        }

        // Merge config with defaults
        const config = { ...DEFAULT_CONFIG, ...printObject.config };
        
        // Check if printer IP is configured
        if (!config.ip) {
            printerLog.error('Printer IP address is not configured');
            return false;
        }
        
        // Log job start
        printerLog.jobStart(config, printObject.items.length);
        
        // Create network device
        const device = new Network(config.ip, config.port);
        
        return new Promise((resolve) => {
            // Set timeout for connection
            const timeoutId = setTimeout(() => {
                printerLog.error('Printer connection timeout', { timeout: config.timeout });
                printerLog.jobComplete(false, Date.now() - startTime);
                resolve(false);
            }, config.timeout);

            device.open(async function(error) {
                clearTimeout(timeoutId);
                
                if (error) {
                    printerLog.error('Failed to connect to printer', error);
                    printerLog.jobComplete(false, Date.now() - startTime);
                    resolve(false);
                    return;
                }
                
                try {
                    printerLog.info('Connected successfully! Processing print job...');
                    
                    // Initialize printer
                    let commands = Buffer.from([0x1B, 0x40]); // ESC @ - Initialize
                    printerLog.dataPreview(commands, 'Initialization commands');
                    
                    // Set character set to support Unicode
                    // ESC t n - Select character code table (UTF-8 = 16)
                    commands = Buffer.concat([commands, Buffer.from([0x1B, 0x74, 16])]);
                    
                    // Set upside down mode if configured
                    if (config.upsideDown) {
                        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x01])]);
                        printerLog.info('Upside down mode enabled');
                    }
                    
                    // Process each item in the print job
                    const sortedItems = config.upsideDown ? printObject.items.reverse() : printObject.items;
                    printerLog.info(`Processing ${sortedItems.length} items...`, { 
                        itemTypes: sortedItems.map(item => item.type) 
                    });
                    
                    for (const item of sortedItems) {
                        const itemCommands = await processItem(item, config);
                        if (itemCommands) {
                            commands = Buffer.concat([commands, itemCommands]);
                            printerLog.info(`Processed item: ${item.type}`, { 
                                size: itemCommands.length,
                                totalSize: commands.length 
                            });
                        }
                    }
                    
                    // Add footer padding and cut
                    const footer = printObject.footer || {};
                    const autoCut = footer.autoCut !== false; // Default true
                    
                    // Always add 6 lines of padding at bottom to prevent cut-off
                    for (let i = 0; i < 6; i++) {
                        commands = Buffer.concat([commands, Buffer.from('\n')]);
                    }
                    
                    // Cut paper if requested
                    if (autoCut) {
                        commands = Buffer.concat([commands, Buffer.from([0x1D, 0x56, 0x00])]);
                        printerLog.info('Auto-cut enabled');
                    }
                    
                    // Reset upside down mode
                    if (config.upsideDown) {
                        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x00])]);
                    }
                    
                    // Log final data being sent to printer
                    printerLog.dataPreview(commands, 'Complete print job data');
                    
                    // Send all commands to printer
                    device.write(commands);
                    printerLog.info('Data sent to printer successfully');
                    
                    // Wait a moment then close connection
                    setTimeout(() => {
                        device.close();
                        printerLog.jobComplete(true, Date.now() - startTime);
                        resolve(true);
                    }, 1000);
                    
                } catch (processingError) {
                    printerLog.error('Error processing print job', processingError);
                    device.close();
                    printerLog.jobComplete(false, Date.now() - startTime);
                    resolve(false);
                }
            });
        });
        
    } catch (error) {
        printerLog.error('Thermal print function error', error);
        printerLog.jobComplete(false, Date.now() - startTime);
        return false;
    }
}

/**
 * Process individual print item
 * @param {Object} item - Print item configuration
 * @param {Object} config - Printer configuration
 * @returns {Promise<Buffer>} - ESC/POS commands for this item
 */
async function processItem(item, config) {
    let commands = Buffer.alloc(0);
    
    try {
        switch (item.type) {
            case 'text':
                commands = processTextItem(item, config);
                break;
                
            case 'image':
                commands = await processImageItem(item, config);
                break;
                
            case 'barcode':
                commands = processBarcodeItem(item, config);
                break;
                
            case 'line':
                commands = processLineItem(item, config);
                break;
                
            case 'space':
                commands = processSpaceItem(item, config);
                break;
                
            case 'cut':
                commands = Buffer.from([0x1D, 0x56, 0x00]); // Cut paper
                break;
                
            case 'feedButton':
                commands = processFeedButtonItem(item, config);
                break;
                
            default:
                console.warn(`Unknown item type: ${item.type}`);
        }
    } catch (error) {
        console.error(`Error processing ${item.type} item:`, error);
    }
    
    return commands;
}

/**
 * Process text item
 * @param {Object} item - Text item configuration
 * @param {Object} config - Printer configuration
 * @returns {Buffer} - ESC/POS commands
 */
function processTextItem(item, config) {
    let commands = Buffer.alloc(0);
    
    // Set alignment
    if (item.align) {
        const alignCode = item.align === 'center' ? 0x01 : 
                         item.align === 'right' ? 0x02 : 0x00;
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }
    
    // Set text size
    if (item.size) {
        const width = Math.max(1, Math.min(8, item.size.width || 1));
        const height = Math.max(1, Math.min(8, item.size.height || 1));
        commands = Buffer.concat([commands, Buffer.from([0x1D, 0x21, ((width - 1) << 4) | (height - 1)])]);
    }
    
    // Set font
    if (item.font) {
        const fontCode = item.font === 'b' ? 0x01 : 0x00;
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x4D, fontCode])]);
    }
    
    // Set text styles
    if (item.style) {
        // Bold
        if (item.style.bold !== undefined) {
            commands = Buffer.concat([commands, Buffer.from([0x1B, 0x45, item.style.bold ? 0x01 : 0x00])]);
        }
        
        // Underline
        if (item.style.underline !== undefined) {
            commands = Buffer.concat([commands, Buffer.from([0x1B, 0x2D, item.style.underline ? 0x01 : 0x00])]);
        }
        
        // Invert (white on black)
        if (item.style.invert !== undefined) {
            commands = Buffer.concat([commands, Buffer.from([0x1D, 0x42, item.style.invert ? 0x01 : 0x00])]);
        }
    }
    
    // Add the text content
    if (item.content) {
        // Use UTF-8 encoding for Unicode support
        const textBuffer = Buffer.from(item.content + '\n', 'utf8');
        commands = Buffer.concat([commands, textBuffer]);
    }
    
    // Reset styles after text
    commands = Buffer.concat([commands, Buffer.from([
        0x1B, 0x45, 0x00, // Bold off
        0x1B, 0x2D, 0x00, // Underline off
        0x1D, 0x42, 0x00, // Invert off
        0x1D, 0x21, 0x00, // Normal size
        0x1B, 0x61, 0x00  // Left align
    ])]);
    
    return commands;
}

/**
 * Process image item
 * @param {Object} item - Image item configuration
 * @param {Object} config - Printer configuration
 * @returns {Promise<Buffer>} - ESC/POS commands
 */
async function processImageItem(item, config) {
    let commands = Buffer.alloc(0);
    
    try {
        // Check if image path exists
        if (!item.path || !fs.existsSync(item.path)) {
            console.error(`Image file not found: ${item.path}`);
            return commands;
        }
        
        // Load the image
        const image = await loadImage(item.path);
        console.log(`Loaded image: ${image.width}x${image.height}`);
        
        // Determine target size
        const targetWidth = item.width || 200;
        const targetHeight = item.height || Math.round((image.height / image.width) * targetWidth);
        
        console.log(`Resizing to: ${targetWidth}x${targetHeight}`);
        
        // Create canvas and resize image
        const canvas = createCanvas(targetWidth, targetHeight);
        const ctx = canvas.getContext('2d');
        
        // Set white background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Draw the resized image
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
        
        // Convert to monochrome bitmap
        const bitmap = convertToMonochrome(canvas, item.threshold || 128);
        
        // Set alignment
        if (item.align) {
            const alignCode = item.align === 'center' ? 0x01 : 
                             item.align === 'right' ? 0x02 : 0x00;
            commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
        }
        
        // Convert bitmap to ESC/POS format using GS v 0 command
        const bitmapCommands = convertBitmapToEscPos(bitmap, canvas.width, canvas.height);
        commands = Buffer.concat([commands, bitmapCommands]);
        
        // Reset alignment
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);
        
    } catch (error) {
        console.error('Error processing image:', error);
    }
    
    return commands;
}

/**
 * Process barcode item
 * @param {Object} item - Barcode item configuration
 * @param {Object} config - Printer configuration
 * @returns {Buffer} - ESC/POS commands
 */
function processBarcodeItem(item, config) {
    let commands = Buffer.alloc(0);
    
    if (!item.content) {
        console.error('Barcode content is required');
        return commands;
    }
    
    // Set alignment
    if (item.align) {
        const alignCode = item.align === 'center' ? 0x01 : 
                         item.align === 'right' ? 0x02 : 0x00;
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }
    
    // Set barcode height
    const height = item.barcodeHeight || 64;
    commands = Buffer.concat([commands, Buffer.from([0x1D, 0x68, height])]);
    
    // Set barcode format and print
    const format = item.format || 'CODE128';
    let formatCode;
    
    switch (format) {
        case 'CODE128':
            formatCode = 73;
            break;
        case 'EAN13':
            formatCode = 67;
            break;
        case 'EAN8':
            formatCode = 68;
            break;
        case 'UPC':
            formatCode = 65;
            break;
        default:
            formatCode = 73; // Default to CODE128
    }
    
    // Print barcode: GS k format_code length data
    const data = Buffer.from(item.content, 'ascii');
    commands = Buffer.concat([
        commands,
        Buffer.from([0x1D, 0x6B, formatCode, data.length]),
        data,
        Buffer.from('\n')
    ]);
    
    // Reset alignment
    commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);
    
    return commands;
}

/**
 * Process line item (horizontal line)
 * @param {Object} item - Line item configuration
 * @param {Object} config - Printer configuration
 * @returns {Buffer} - ESC/POS commands
 */
function processLineItem(item, config) {
    const char = item.content || '-';
    const length = item.width || 48;
    const line = char.repeat(length);
    
    let commands = Buffer.alloc(0);
    
    // Set alignment
    if (item.align) {
        const alignCode = item.align === 'center' ? 0x01 : 
                         item.align === 'right' ? 0x02 : 0x00;
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }
    
    commands = Buffer.concat([commands, Buffer.from(line + '\n', 'utf8')]);
    
    // Reset alignment
    commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);
    
    return commands;
}

/**
 * Process space item (blank lines)
 * @param {Object} item - Space item configuration
 * @param {Object} config - Printer configuration
 * @returns {Buffer} - ESC/POS commands
 */
function processSpaceItem(item, config) {
    const lines = item.lines || 1;
    let commands = Buffer.alloc(0);
    
    for (let i = 0; i < lines; i++) {
        commands = Buffer.concat([commands, Buffer.from('\n')]);
    }
    
    return commands;
}

/**
 * Process feed button control item
 * @param {Object} item - Feed button item configuration
 * @param {Object} config - Printer configuration
 * @returns {Buffer} - ESC/POS commands
 */
function processFeedButtonItem(item, config) {
    // ESC c 5 n - Enable/disable panel buttons
    // ESC = 0x1B, c = 0x63, 5 = 0x35 (ASCII '5')
    // n = 0: disable feed button, n = 1: enable feed button
    
    const enableCode = item.enabled ? 0x01 : 0x00;
    const command = Buffer.from([0x1B, 0x63, 0x35, enableCode]);
    
    console.log(`Setting feed button: ${item.enabled ? 'enabled' : 'disabled'} (command: ${Array.from(command).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')})`);
    
    return command;
}

/**
 * Convert canvas to monochrome bitmap
 * @param {Canvas} canvas - Canvas object
 * @param {number} threshold - Threshold for black/white conversion (0-255)
 * @returns {Array<Array<number>>} - 2D array of 0s and 1s
 */
function convertToMonochrome(canvas, threshold = 128) {
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const bitmap = [];
    
    for (let y = 0; y < canvas.height; y++) {
        const row = [];
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const r = imageData.data[i];
            const g = imageData.data[i + 1];
            const b = imageData.data[i + 2];
            const a = imageData.data[i + 3];
            
            // Convert to grayscale and threshold
            const gray = (r + g + b) / 3;
            // Consider transparent pixels as white (0)
            const isBlack = a > 128 && gray < threshold ? 1 : 0;
            row.push(isBlack);
        }
        bitmap.push(row);
    }
    
    return bitmap;
}

/**
 * Convert bitmap to ESC/POS commands using GS v 0
 * @param {Array<Array<number>>} bitmap - 2D bitmap array
 * @param {number} width - Bitmap width in pixels
 * @param {number} height - Bitmap height in pixels
 * @returns {Buffer} - ESC/POS commands
 */
function convertBitmapToEscPos(bitmap, width, height) {
    const widthBytes = Math.ceil(width / 8);
    
    // GS v 0 m xL xH yL yH [bitmap data]
    const xL = widthBytes & 0xFF;
    const xH = (widthBytes >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;
    
    let commands = Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
    
    // Convert bitmap to bytes
    for (let y = 0; y < height; y++) {
        for (let byteX = 0; byteX < widthBytes; byteX++) {
            let byte = 0;
            for (let bit = 0; bit < 8; bit++) {
                const pixelX = byteX * 8 + bit;
                if (pixelX < width && bitmap[y] && bitmap[y][pixelX]) {
                    byte |= (1 << (7 - bit));
                }
            }
            commands = Buffer.concat([commands, Buffer.from([byte])]);
        }
    }
    
    return commands;
}

/**
 * Helper function to create a simple text print job
 * @param {string} text - Text to print
 * @param {Object} options - Optional formatting
 * @returns {Object} - Print object ready for thermalPrint()
 */
export function createTextPrint(text, options = {}) {
    return {
        config: options.config,
        items: [
            {
                type: 'text',
                content: text,
                align: options.align || 'left',
                size: options.size,
                style: options.style
            }
        ],
        footer: options.footer
    };
}

/**
 * Helper function to create a print job for upside-down mounted printers
 * @param {Object} printObject - Original print object
 * @returns {Object} - Modified print object with upside-down configuration
 */
export function createUpsideDownPrint(printObject) {
    return {
        ...printObject,
        config: {
            ...printObject.config,
            upsideDown: true
        }
    };
}

/**
 * Helper function to create an image print job
 * @param {string} imagePath - Path to image file
 * @param {Object} options - Optional formatting
 * @returns {Object} - Print object ready for thermalPrint()
 */
export function createImagePrint(imagePath, options = {}) {

    //use canvas to measure image size
    if (!imagePath || !fs.existsSync(imagePath)) {
        console.error(`Image file not found: ${imagePath}`);
        return null;
    }
    const image = loadImage(imagePath);
    console.log(`Loaded image: ${image.width}x${image.height}`);
    const targetWidth = options.width || 575; // Default width
    const targetHeight = options.height || Math.round((image.height / image.width) * targetWidth);
    const [imgW, imgH] = [targetWidth, targetHeight];

    return {
        config: options.config,
        items: [
            {
                type: 'image',
                path: imagePath,
                width: imgW,
                height: imgH,
                align: options.align || 'center',
                threshold: options.threshold
            }
        ],
        footer: options.footer
    };
}

/**
 * Helper function to create a receipt-style print job
 * @param {Object} receiptData - Receipt data
 * @returns {Object} - Print object ready for thermalPrint()
 */
export function createReceiptPrint(receiptData) {
    const items = [];
    
    // Header
    if (receiptData.header) {
        items.push({
            type: 'text',
            content: receiptData.header,
            align: 'center',
            size: { width: 2, height: 2 },
            style: { bold: true }
        });
        items.push({ type: 'space', lines: 1 });
    }
    
    // Date/time
    if (receiptData.datetime !== false) {
        items.push({
            type: 'text',
            content: receiptData.datetime || new Date().toLocaleString(),
            align: 'center'
        });
        items.push({ type: 'line', align: 'center', width: 32 });
        items.push({ type: 'space', lines: 1 });
    }
    
    // Items
    if (receiptData.items) {
        receiptData.items.forEach(item => {
            items.push({
                type: 'text',
                content: `${item.name}${item.price ? ` - $${item.price}` : ''}`,
                align: 'left'
            });
        });
        items.push({ type: 'space', lines: 1 });
    }
    
    // Total
    if (receiptData.total) {
        items.push({ type: 'line', align: 'center', width: 32 });
        items.push({
            type: 'text',
            content: `TOTAL: $${receiptData.total}`,
            align: 'center',
            style: { bold: true }
        });
    }
    
    // Footer
    if (receiptData.footer) {
        items.push({ type: 'space', lines: 1 });
        items.push({
            type: 'text',
            content: receiptData.footer,
            align: 'center'
        });
    }
    
    return {
        config: receiptData.config,
        items,
        footer: { paddingLines: 3, autoCut: true }
    };
}

/**
 * Helper function to create a table print job with ASCII formatting
 * @param {Object} tableData - Table data and configuration
 * @returns {Object} - Print object ready for thermalPrint()
 */
export function createTablePrint(tableData) {
    const { 
        title, 
        headers = [], 
        rows = [], 
        width = 48,
        config,
        footer 
    } = tableData;
    
    const items = [];
    
    // Calculate column widths
    const numCols = headers.length || (rows.length > 0 ? rows[0].length : 0);
    if (numCols === 0) {
        throw new Error('Table must have headers or data rows');
    }
    
    // Reserve space for separators (| between columns and at edges)
    const separatorSpace = numCols + 1;
    const availableWidth = width - separatorSpace;
    const colWidth = Math.floor(availableWidth / numCols);
    
    // Helper function to pad text to specific width
    const padText = (text, width, align = 'left') => {
        const str = String(text || '');
        
        // Calculate visual width considering wide characters (like Korean)
        let visualWidth = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            // Korean characters and other wide characters typically take 2 spaces
            if (char.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/)) {
                visualWidth += 2;
            } else {
                visualWidth += 1;
            }
        }
        
        // Truncate if too long
        if (visualWidth > width) {
            let truncated = '';
            let currentWidth = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                const charWidth = char.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/) ? 2 : 1;
                if (currentWidth + charWidth > width) break;
                truncated += char;
                currentWidth += charWidth;
            }
            return truncated.padEnd(width, ' ');
        }
        
        // Pad based on alignment
        const padding = width - visualWidth;
        if (align === 'center') {
            const leftPad = Math.floor(padding / 2);
            const rightPad = padding - leftPad;
            return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
        } else if (align === 'right') {
            return ' '.repeat(padding) + str;
        }
        return str + ' '.repeat(padding);
    };
    
    // Helper function to create separator line
    const createSeparator = (type = 'normal') => {
        const chars = {
            top: { left: '+', middle: '+', right: '+', horizontal: '-' },
            normal: { left: '+', middle: '+', right: '+', horizontal: '-' },
            bottom: { left: '+', middle: '+', right: '+', horizontal: '-' }
        };
        
        const char = chars[type] || chars.normal;
        let line = char.left;
        for (let i = 0; i < numCols; i++) {
            line += char.horizontal.repeat(colWidth);
            if (i < numCols - 1) {
                line += char.middle;
            }
        }
        line += char.right;
        return line;
    };
    
    // Helper function to create table row
    const createRow = (data, style = {}) => {
        let row = '|';
        for (let i = 0; i < numCols; i++) {
            const cellData = data[i] || '';
            const align = (i === numCols - 1 && !isNaN(cellData)) ? 'right' : 'left';
            row += padText(cellData, colWidth, align) + '|';
        }
        return row;
    };
    
    // Title
    if (title) {
        items.push({
            type: 'text',
            content: title,
            align: 'center',
            style: { bold: true }
        });
        items.push({ type: 'space', lines: 1 });
    }
    
    // Top border
    items.push({
        type: 'text',
        content: createSeparator('top'),
        align: 'left'
    });
    
    // Headers
    if (headers.length > 0) {
        items.push({
            type: 'text',
            content: createRow(headers),
            align: 'left',
            style: { bold: true }
        });
        
        items.push({
            type: 'text',
            content: createSeparator('normal'),
            align: 'left'
        });
    }
    
    // Data rows
    rows.forEach((row, index) => {
        items.push({
            type: 'text',
            content: createRow(row),
            align: 'left'
        });
    });
    
    // Bottom border
    items.push({
        type: 'text',
        content: createSeparator('bottom'),
        align: 'left'
    });
    
    return {
        config: config,
        items,
        footer: footer || { paddingLines: 2, autoCut: true }
    };
}

/**
 * Query printer status including feed button state
 * @param {Object} config - Optional printer configuration
 * @returns {Promise<Object>} - Printer status information
 */
export async function queryPrinterStatus(config = {}) {
    try {
        // Merge config with defaults
        const printerConfig = { ...DEFAULT_CONFIG, ...config };
        
        // Check if printer IP is configured
        if (!printerConfig.ip) {
            console.error('Printer IP address is not configured');
            return { success: false, error: 'Printer IP not configured' };
        }
        
        console.log(`Querying printer status at ${printerConfig.ip}:${printerConfig.port}...`);
        
        // Create network device
        const device = new Network(printerConfig.ip, printerConfig.port);
        
        return new Promise((resolve) => {
            // Set timeout for connection
            const timeoutId = setTimeout(() => {
                console.error('Printer status query timeout');
                resolve({ success: false, error: 'Connection timeout' });
            }, printerConfig.timeout);

            device.open(async function(error) {
                clearTimeout(timeoutId);
                
                if (error) {
                    console.error('Failed to connect to printer for status query:', error);
                    resolve({ success: false, error: 'Connection failed', details: error.message });
                    return;
                }
                
                try {
                    console.log('Connected successfully! Querying printer status...');
                    
                    // Query real-time status using DLE EOT commands
                    // DLE EOT 1 - Printer status
                    // DLE EOT 2 - Offline status  
                    // DLE EOT 3 - Error status
                    // DLE EOT 4 - Paper sensor status
                    
                    const queries = [
                        Buffer.from([0x10, 0x04, 0x01]), // Printer status
                        Buffer.from([0x10, 0x04, 0x02]), // Offline status
                        Buffer.from([0x10, 0x04, 0x03]), // Error status
                        Buffer.from([0x10, 0x04, 0x04])  // Paper sensor status
                    ];
                    
                    const responses = [];
                    let queryIndex = 0;
                    
                    // Function to send next query
                    const sendNextQuery = () => {
                        if (queryIndex < queries.length) {
                            device.write(queries[queryIndex]);
                            queryIndex++;
                            setTimeout(sendNextQuery, 100); // Wait 100ms between queries
                        } else {
                            // All queries sent, wait for responses then close
                            setTimeout(() => {
                                device.close();
                                
                                // Parse responses and determine feed button status
                                const status = parseStatusResponses(responses);
                                console.log('Printer status query completed');
                                resolve({ 
                                    success: true, 
                                    ...status,
                                    timestamp: new Date().toISOString()
                                });
                            }, 200);
                        }
                    };
                    
                    // Listen for data responses
                    device.on('data', (data) => {
                        responses.push(data);
                    });
                    
                    // Start querying
                    sendNextQuery();
                    
                } catch (processingError) {
                    console.error('Error querying printer status:', processingError);
                    device.close();
                    resolve({ success: false, error: 'Query processing error', details: processingError.message });
                }
            });
        });
        
    } catch (error) {
        console.error('Printer status query error:', error);
        return { success: false, error: 'Query failed', details: error.message };
    }
}

/**
 * Parse status response bytes from printer
 * @param {Array<Buffer>} responses - Array of response buffers
 * @returns {Object} - Parsed status information
 */
function parseStatusResponses(responses) {
    const status = {
        online: false,
        feedButtonEnabled: null, // Cannot be directly determined from most printers
        paperPresent: false,
        errors: [],
        coverOpen: false,
        cutterOk: true,
        rawResponses: responses.map(r => Array.from(r))
    };
    
    responses.forEach((response, index) => {
        if (response.length > 0) {
            const byte = response[0];
            
            switch (index) {
                case 0: // Printer status
                    status.online = (byte & 0x08) === 0; // Bit 3: 0 = online, 1 = offline
                    status.coverOpen = (byte & 0x04) !== 0; // Bit 2: cover open
                    break;
                    
                case 1: // Offline status
                    status.coverOpen = status.coverOpen || (byte & 0x04) !== 0;
                    break;
                    
                case 2: // Error status
                    if (byte & 0x08) status.errors.push('cutter_error');
                    if (byte & 0x20) status.errors.push('unrecoverable_error');
                    if (byte & 0x40) status.errors.push('auto_recoverable_error');
                    break;
                    
                case 3: // Paper sensor status
                    status.paperPresent = (byte & 0x60) === 0; // Bits 5-6: paper status
                    break;
            }
        }
    });
    
    // Note: Feed button status cannot be reliably queried from most ESC/POS printers
    // The ESC c 5 command only sets the state, it doesn't provide a way to read it back
    status.feedButtonEnabled = 'unknown';
    status.note = 'Feed button status cannot be queried directly from most ESC/POS printers';
    
    return status;
}

/**
 * Test feed button functionality with printer
 * @param {Object} config - Optional printer configuration
 * @returns {Promise<Object>} - Test results
 */
export async function testFeedButton(config = {}) {
    try {
        console.log('Testing feed button functionality...');
        
        // Test disabling feed button
        console.log('Step 1: Disabling feed button...');
        const disableResult = await thermalPrint(setFeedButton(false, config));
        
        if (!disableResult) {
            return { success: false, error: 'Failed to disable feed button' };
        }
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Test enabling feed button
        console.log('Step 2: Enabling feed button...');
        const enableResult = await thermalPrint(setFeedButton(true, config));
        
        if (!enableResult) {
            return { success: false, error: 'Failed to enable feed button' };
        }
        
        return {
            success: true,
            message: 'Feed button test completed successfully',
            steps: {
                disable: disableResult,
                enable: enableResult
            },
            note: 'Check printer physically to verify feed button response'
        };
        
    } catch (error) {
        return {
            success: false,
            error: 'Feed button test failed',
            details: error.message
        };
    }
}

/**
 * Helper function to control the feed button on the thermal printer
 * @param {boolean} enabled - Whether to enable (true) or disable (false) the feed button
 * @param {Object} config - Optional printer configuration
 * @returns {Object} - Print object ready for thermalPrint()
 */
export function setFeedButton(enabled, config = {}) {
    return {
        config: config,
        items: [
            {
                type: 'feedButton',
                enabled: enabled
            }
        ],
        footer: { paddingLines: 0, autoCut: false }
    };
}

// Log container startup to help correlate with printer issues
export function logContainerStartup() {
    printerLog.info('DaylightStation container started', {
        timestamp: new Date().toISOString(),
        printerConfig: {
            host: DEFAULT_CONFIG.ip,
            port: DEFAULT_CONFIG.port,
            timeout: DEFAULT_CONFIG.timeout
        }
    });
    
    // Test printer connectivity on startup
    testPrinterConnection();
}

// Test printer connection without printing
async function testPrinterConnection() {
    try {
        const config = DEFAULT_CONFIG;
        if (!config.ip) {
            printerLog.warn('Printer IP not configured for startup test');
            return false;
        }
        
        const device = new Network(config.ip, config.port);
        
        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                printerLog.warn('Startup printer test timeout');
                resolve(false);
            }, 3000); // Shorter timeout for startup test
            
            device.open(function(error) {
                clearTimeout(timeoutId);
                
                if (error) {
                    printerLog.warn('Startup printer test failed', error);
                    resolve(false);
                    return;
                }
                
                device.close();
                printerLog.info('Startup printer test successful');
                resolve(true);
            });
        });
        
    } catch (error) {
        printerLog.error('Startup printer test error', error);
        return false;
    }
}

// Call startup logging when this module is loaded
logContainerStartup();
export default thermalPrint;
