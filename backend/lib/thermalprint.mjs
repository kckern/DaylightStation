import escpos from 'escpos';
import Network from 'escpos-network';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';

// Default thermal printer configuration
const DEFAULT_CONFIG = {
    ip: process.env.printer?.host || null,
    port: process.env.printer?.port || 9100,
    timeout: 5000,
    encoding: 'utf8',
    upsideDown: false
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
    try {
        // Validate input
        if (!printObject || !printObject.items || !Array.isArray(printObject.items)) {
            console.error('Invalid printObject: must have items array');
            return false;
        }

        // Merge config with defaults
        const config = { ...DEFAULT_CONFIG, ...printObject.config };
        
        // Check if printer IP is configured
        if (!config.ip) {
            console.error('Printer IP address is not configured');
            return false;
        }
        
        console.log(`Connecting to thermal printer at ${config.ip}:${config.port}...`);
        
        // Create network device
        const device = new Network(config.ip, config.port);
        
        return new Promise((resolve) => {
            // Set timeout for connection
            const timeoutId = setTimeout(() => {
                console.error('Printer connection timeout');
                resolve(false);
            }, config.timeout);

            device.open(async function(error) {
                clearTimeout(timeoutId);
                
                if (error) {
                    console.error('Failed to connect to printer:', error);
                    resolve(false);
                    return;
                }
                
                try {
                    console.log('Connected successfully! Processing print job...');
                    
                    // Initialize printer
                    let commands = Buffer.from([0x1B, 0x40]); // ESC @ - Initialize
                    
                    // Set upside down mode if configured
                    if (config.upsideDown) {
                        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x01])]);
                    }
                    
                    // Process each item in the print job
                    for (const item of printObject.items) {
                        const itemCommands = await processItem(item, config);
                        if (itemCommands) {
                            commands = Buffer.concat([commands, itemCommands]);
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
                    }
                    
                    // Reset upside down mode
                    if (config.upsideDown) {
                        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x00])]);
                    }
                    
                    // Send all commands to printer
                    device.write(commands);
                    
                    // Wait a moment then close connection
                    setTimeout(() => {
                        device.close();
                        console.log('Print job completed successfully!');
                        resolve(true);
                    }, 1000);
                    
                } catch (processingError) {
                    console.error('Error processing print job:', processingError);
                    device.close();
                    resolve(false);
                }
            });
        });
        
    } catch (error) {
        console.error('Thermal print error:', error);
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
        commands = Buffer.concat([commands, Buffer.from(item.content + '\n', item.encoding || config.encoding)]);
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
    
    commands = Buffer.concat([commands, Buffer.from(line + '\n', config.encoding)]);
    
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
    return {
        config: options.config,
        items: [
            {
                type: 'image',
                path: imagePath,
                width: options.width,
                height: options.height,
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

export default thermalPrint;
