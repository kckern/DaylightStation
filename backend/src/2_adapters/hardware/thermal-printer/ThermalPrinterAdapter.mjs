/**
 * ThermalPrinterAdapter - ESC/POS thermal printer control
 *
 * Provides network-based thermal printer control using ESC/POS protocol.
 * Features:
 * - Text, image, barcode, line, space printing
 * - Receipt and table formatting helpers
 * - Print job queueing to prevent concurrency issues
 * - Upside-down mode for mounted printers
 * - Ping and status querying
 *
 * @module adapters/hardware/thermal-printer
 */

import escpos from 'escpos';
import Network from 'escpos-network';
import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';
import { configService } from '../../../0_infrastructure/config/index.mjs';
import { nowTs24 } from '../../../0_infrastructure/utils/index.mjs';

/**
 * @typedef {Object} PrinterConfig
 * @property {string} host - Printer IP address
 * @property {number} [port=9100] - Printer port
 * @property {number} [timeout=5000] - Connection timeout in ms
 * @property {string} [encoding='utf8'] - Text encoding
 * @property {boolean} [upsideDown=true] - Enable upside-down mode for mounted printers
 */

/**
 * @typedef {Object} PrintItem
 * @property {'text'|'image'|'barcode'|'line'|'space'|'cut'|'feedButton'} type
 * @property {string} [content] - Text content or image path
 * @property {'left'|'center'|'right'} [align='left'] - Text alignment
 * @property {Object} [size] - Text size {width, height}
 * @property {'a'|'b'} [font] - Font selection
 * @property {Object} [style] - {bold, underline, invert}
 * @property {string} [path] - Image file path
 * @property {number} [width] - Image width in pixels
 * @property {number} [height] - Image height in pixels
 * @property {number} [threshold=128] - B&W threshold (0-255)
 * @property {'CODE128'|'EAN13'|'EAN8'|'UPC'} [format] - Barcode format
 * @property {number} [barcodeHeight=64] - Barcode height in dots
 * @property {number} [lines=1] - Number of blank lines for space
 * @property {boolean} [enabled] - Feed button enabled state
 */

/**
 * @typedef {Object} PrintJob
 * @property {PrinterConfig} [config] - Override default config
 * @property {PrintItem[]} items - Array of items to print
 * @property {Object} [footer] - Footer options {paddingLines, autoCut}
 */

export class ThermalPrinterAdapter {
  #host;
  #port;
  #timeout;
  #encoding;
  #upsideDown;
  #logger;
  #printQueue;

  /**
   * @param {PrinterConfig} config
   * @param {Object} [options]
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(config, options = {}) {
    this.#host = config.host;
    this.#port = config.port || 9100;
    this.#timeout = config.timeout || 5000;
    this.#encoding = config.encoding || 'utf8';
    this.#upsideDown = config.upsideDown !== false; // Default true
    this.#logger = options.logger || console;
    this.#printQueue = Promise.resolve();
  }

  /**
   * Check if adapter is configured
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.#host);
  }

  /**
   * Get printer host
   * @returns {string}
   */
  getHost() {
    return this.#host;
  }

  /**
   * Get printer port
   * @returns {number}
   */
  getPort() {
    return this.#port;
  }

  /**
   * Ping printer to check if it's reachable
   * @returns {Promise<{success: boolean, latency?: number, error?: string}>}
   */
  async ping() {
    if (!this.#host) {
      return { success: false, error: 'Printer IP not configured', configured: false };
    }

    const startTime = Date.now();
    const device = new Network(this.#host, this.#port);

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: 'Connection timeout',
          host: this.#host,
          port: this.#port,
          latency: Date.now() - startTime,
          configured: true
        });
      }, this.#timeout);

      device.open((error) => {
        clearTimeout(timeoutId);
        const latency = Date.now() - startTime;

        if (error) {
          resolve({
            success: false,
            error: error.message || 'Connection failed',
            host: this.#host,
            port: this.#port,
            latency,
            configured: true
          });
          return;
        }

        device.close();
        resolve({
          success: true,
          message: 'Printer is reachable',
          host: this.#host,
          port: this.#port,
          latency,
          configured: true
        });
      });
    });
  }

  /**
   * Query printer status
   * @returns {Promise<{success: boolean, online?: boolean, paperPresent?: boolean, errors?: string[]}>}
   */
  async getStatus() {
    if (!this.#host) {
      return { success: false, error: 'Printer IP not configured' };
    }

    const device = new Network(this.#host, this.#port);

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({ success: false, error: 'Connection timeout' });
      }, this.#timeout);

      device.open(async (error) => {
        clearTimeout(timeoutId);

        if (error) {
          resolve({ success: false, error: 'Connection failed', details: error.message });
          return;
        }

        try {
          const responses = [];
          const queries = [
            Buffer.from([0x10, 0x04, 0x01]), // Printer status
            Buffer.from([0x10, 0x04, 0x02]), // Offline status
            Buffer.from([0x10, 0x04, 0x03]), // Error status
            Buffer.from([0x10, 0x04, 0x04])  // Paper sensor status
          ];

          device.on('data', (data) => {
            responses.push(data);
          });

          let queryIndex = 0;
          const sendNextQuery = () => {
            if (queryIndex < queries.length) {
              device.write(queries[queryIndex]);
              queryIndex++;
              setTimeout(sendNextQuery, 100);
            } else {
              setTimeout(() => {
                device.close();
                const status = this.#parseStatusResponses(responses);
                resolve({
                  success: true,
                  ...status,
                  timestamp: nowTs24()
                });
              }, 200);
            }
          };

          sendNextQuery();
        } catch (processingError) {
          device.close();
          resolve({ success: false, error: 'Query processing error', details: processingError.message });
        }
      });
    });
  }

  /**
   * Print a job
   * @param {PrintJob} printJob
   * @returns {Promise<boolean>}
   */
  async print(printJob) {
    const result = await new Promise((resolve) => {
      this.#printQueue = this.#printQueue.then(async () => {
        try {
          await new Promise(r => setTimeout(r, 500)); // Delay between jobs
          const res = await this.#executePrintJob(printJob);
          resolve(res);
        } catch (e) {
          this.#logger.error?.('thermalPrinter.queue.error', { error: e.message });
          resolve(false);
        }
      });
    });
    return result;
  }

  /**
   * Create a simple text print job
   * @param {string} text
   * @param {Object} [options]
   * @returns {PrintJob}
   */
  createTextPrint(text, options = {}) {
    return {
      config: options.config,
      items: [{
        type: 'text',
        content: text,
        align: options.align || 'left',
        size: options.size,
        style: options.style
      }],
      footer: options.footer
    };
  }

  /**
   * Create an image print job
   * @param {string} imagePath
   * @param {Object} [options]
   * @returns {PrintJob}
   */
  createImagePrint(imagePath, options = {}) {
    return {
      config: options.config,
      items: [{
        type: 'image',
        path: imagePath,
        width: options.width || 575,
        height: options.height,
        align: options.align || 'center',
        threshold: options.threshold || 128
      }],
      footer: options.footer
    };
  }

  /**
   * Create a receipt-style print job
   * @param {Object} receiptData
   * @returns {PrintJob}
   */
  createReceiptPrint(receiptData) {
    const items = [];

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

    if (receiptData.datetime !== false) {
      items.push({
        type: 'text',
        content: receiptData.datetime || new Date().toLocaleString(),
        align: 'center'
      });
      items.push({ type: 'line', align: 'center', width: 32 });
      items.push({ type: 'space', lines: 1 });
    }

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

    if (receiptData.total) {
      items.push({ type: 'line', align: 'center', width: 32 });
      items.push({
        type: 'text',
        content: `TOTAL: $${receiptData.total}`,
        align: 'center',
        style: { bold: true }
      });
    }

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
   * Create a table print job
   * @param {Object} tableData
   * @returns {PrintJob}
   */
  createTablePrint(tableData) {
    const { title, headers = [], rows = [], width = 48, config, footer } = tableData;
    const items = [];

    const numCols = headers.length || (rows.length > 0 ? rows[0].length : 0);
    if (numCols === 0) {
      throw new Error('Table must have headers or data rows');
    }

    const separatorSpace = numCols + 1;
    const availableWidth = width - separatorSpace;
    const colWidth = Math.floor(availableWidth / numCols);

    const padText = (text, width, align = 'left') => {
      const str = String(text || '');
      let visualWidth = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (char.match(/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/)) {
          visualWidth += 2;
        } else {
          visualWidth += 1;
        }
      }

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

    const createSeparator = () => {
      let line = '+';
      for (let i = 0; i < numCols; i++) {
        line += '-'.repeat(colWidth);
        line += i < numCols - 1 ? '+' : '+';
      }
      return line;
    };

    const createRow = (data) => {
      let row = '|';
      for (let i = 0; i < numCols; i++) {
        const cellData = data[i] || '';
        const align = (i === numCols - 1 && !isNaN(cellData)) ? 'right' : 'left';
        row += padText(cellData, colWidth, align) + '|';
      }
      return row;
    };

    if (title) {
      items.push({ type: 'text', content: title, align: 'center', style: { bold: true } });
      items.push({ type: 'space', lines: 1 });
    }

    items.push({ type: 'text', content: createSeparator(), align: 'left' });

    if (headers.length > 0) {
      items.push({ type: 'text', content: createRow(headers), align: 'left', style: { bold: true } });
      items.push({ type: 'text', content: createSeparator(), align: 'left' });
    }

    rows.forEach(row => {
      items.push({ type: 'text', content: createRow(row), align: 'left' });
    });

    items.push({ type: 'text', content: createSeparator(), align: 'left' });

    return {
      config,
      items,
      footer: footer || { paddingLines: 2, autoCut: true }
    };
  }

  /**
   * Set feed button state
   * @param {boolean} enabled
   * @returns {PrintJob}
   */
  setFeedButton(enabled) {
    return {
      items: [{ type: 'feedButton', enabled }],
      footer: { paddingLines: 0, autoCut: false }
    };
  }

  /**
   * Test feed button functionality
   * Migrated from: thermalprint.mjs:1126-1156
   * @returns {Promise<{success: boolean, message?: string, steps?: Object, note?: string, error?: string, details?: string}>}
   */
  async testFeedButton() {
    try {
      this.#logger.info?.('thermalPrinter.testFeedButton.start');

      // Step 1: Disable feed button
      const disableResult = await this.print(this.setFeedButton(false));
      if (!disableResult) {
        return { success: false, error: 'Feed button test failed', details: 'Failed to disable feed button' };
      }

      // Wait a moment (legacy uses 1000ms)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Step 2: Enable feed button
      const enableResult = await this.print(this.setFeedButton(true));
      if (!enableResult) {
        return { success: false, error: 'Feed button test failed', details: 'Failed to enable feed button' };
      }

      this.#logger.info?.('thermalPrinter.testFeedButton.complete');

      // Match legacy return shape with steps and note
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
      this.#logger.error?.('thermalPrinter.testFeedButton.error', { error: error.message });
      // Match legacy error shape with 'error' and 'details' fields
      return { success: false, error: 'Feed button test failed', details: error.message };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  async #executePrintJob(printJob) {
    const startTime = Date.now();

    try {
      if (!printJob?.items || !Array.isArray(printJob.items)) {
        this.#logger.error?.('thermalPrinter.invalidJob', { message: 'Must have items array' });
        return false;
      }

      const config = {
        host: this.#host,
        port: this.#port,
        timeout: this.#timeout,
        encoding: this.#encoding,
        upsideDown: this.#upsideDown,
        ...printJob.config
      };

      if (!config.host) {
        this.#logger.error?.('thermalPrinter.noHost', { message: 'Printer IP not configured' });
        return false;
      }

      this.#logger.info?.('thermalPrinter.job.start', {
        target: `${config.host}:${config.port}`,
        itemCount: printJob.items.length,
        upsideDown: config.upsideDown
      });

      const device = new Network(config.host, config.port);

      return new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          this.#logger.error?.('thermalPrinter.timeout', { timeout: config.timeout });
          resolve(false);
        }, config.timeout);

        device.open(async (error) => {
          clearTimeout(timeoutId);

          if (error) {
            this.#logger.error?.('thermalPrinter.connect.failed', { error: error.message });
            resolve(false);
            return;
          }

          try {
            let commands = Buffer.from([0x1B, 0x40]); // ESC @ - Initialize
            commands = Buffer.concat([commands, Buffer.from([0x1B, 0x74, 16])]); // UTF-8

            if (config.upsideDown) {
              commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x01])]);
            }

            const sortedItems = config.upsideDown ? [...printJob.items].reverse() : printJob.items;

            for (const item of sortedItems) {
              const itemCommands = await this.#processItem(item, config);
              if (itemCommands) {
                commands = Buffer.concat([commands, itemCommands]);
              }
            }

            // Footer padding
            for (let i = 0; i < 6; i++) {
              commands = Buffer.concat([commands, Buffer.from('\n')]);
            }

            // Auto-cut
            const footer = printJob.footer || {};
            if (footer.autoCut !== false) {
              commands = Buffer.concat([commands, Buffer.from([0x1D, 0x56, 0x00])]);
            }

            // Reset upside down
            if (config.upsideDown) {
              commands = Buffer.concat([commands, Buffer.from([0x1B, 0x7B, 0x00])]);
            }

            device.write(commands);

            setTimeout(() => {
              device.close();
              this.#logger.info?.('thermalPrinter.job.complete', { duration: Date.now() - startTime });
              resolve(true);
            }, 1000);

          } catch (processingError) {
            this.#logger.error?.('thermalPrinter.process.error', { error: processingError.message });
            device.close();
            resolve(false);
          }
        });
      });

    } catch (error) {
      this.#logger.error?.('thermalPrinter.error', { error: error.message });
      return false;
    }
  }

  async #processItem(item, config) {
    let commands = Buffer.alloc(0);

    try {
      switch (item.type) {
        case 'text':
          commands = this.#processTextItem(item);
          break;
        case 'image':
          commands = await this.#processImageItem(item);
          break;
        case 'barcode':
          commands = this.#processBarcodeItem(item);
          break;
        case 'line':
          commands = this.#processLineItem(item);
          break;
        case 'space':
          commands = this.#processSpaceItem(item);
          break;
        case 'cut':
          commands = Buffer.from([0x1D, 0x56, 0x00]);
          break;
        case 'feedButton':
          commands = Buffer.from([0x1B, 0x63, 0x35, item.enabled ? 0x01 : 0x00]);
          break;
        default:
          this.#logger.warn?.('thermalPrinter.unknownItemType', { type: item.type });
      }
    } catch (error) {
      this.#logger.error?.('thermalPrinter.processItem.error', { type: item.type, error: error.message });
    }

    return commands;
  }

  #processTextItem(item) {
    let commands = Buffer.alloc(0);

    // Alignment
    if (item.align) {
      const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }

    // Size
    if (item.size) {
      const width = Math.max(1, Math.min(8, item.size.width || 1));
      const height = Math.max(1, Math.min(8, item.size.height || 1));
      commands = Buffer.concat([commands, Buffer.from([0x1D, 0x21, ((width - 1) << 4) | (height - 1)])]);
    }

    // Font
    if (item.font) {
      const fontCode = item.font === 'b' ? 0x01 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x4D, fontCode])]);
    }

    // Styles
    if (item.style) {
      if (item.style.bold !== undefined) {
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x45, item.style.bold ? 0x01 : 0x00])]);
      }
      if (item.style.underline !== undefined) {
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x2D, item.style.underline ? 0x01 : 0x00])]);
      }
      if (item.style.invert !== undefined) {
        commands = Buffer.concat([commands, Buffer.from([0x1D, 0x42, item.style.invert ? 0x01 : 0x00])]);
      }
    }

    // Content
    if (item.content) {
      const textBuffer = Buffer.from(item.content + '\n', 'utf8');
      commands = Buffer.concat([commands, textBuffer]);
    }

    // Reset styles
    commands = Buffer.concat([commands, Buffer.from([
      0x1B, 0x45, 0x00, // Bold off
      0x1B, 0x2D, 0x00, // Underline off
      0x1D, 0x42, 0x00, // Invert off
      0x1D, 0x21, 0x00, // Normal size
      0x1B, 0x61, 0x00  // Left align
    ])]);

    return commands;
  }

  async #processImageItem(item) {
    let commands = Buffer.alloc(0);

    try {
      if (!item.path || !fs.existsSync(item.path)) {
        this.#logger.error?.('thermalPrinter.image.notFound', { path: item.path });
        return commands;
      }

      const image = await loadImage(item.path);
      const targetWidth = item.width || 200;
      const targetHeight = item.height || Math.round((image.height / image.width) * targetWidth);

      const canvas = createCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');

      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

      const bitmap = this.#convertToMonochrome(canvas, item.threshold || 128);

      // Alignment
      if (item.align) {
        const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
        commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
      }

      const bitmapCommands = this.#convertBitmapToEscPos(bitmap, canvas.width, canvas.height);
      commands = Buffer.concat([commands, bitmapCommands]);

      // Reset alignment
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);

    } catch (error) {
      this.#logger.error?.('thermalPrinter.image.error', { error: error.message });
    }

    return commands;
  }

  #processBarcodeItem(item) {
    let commands = Buffer.alloc(0);

    if (!item.content) {
      return commands;
    }

    // Alignment
    if (item.align) {
      const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }

    // Height
    const height = item.barcodeHeight || 64;
    commands = Buffer.concat([commands, Buffer.from([0x1D, 0x68, height])]);

    // Format
    const formatCodes = { CODE128: 73, EAN13: 67, EAN8: 68, UPC: 65 };
    const formatCode = formatCodes[item.format] || 73;

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

  #processLineItem(item) {
    const char = item.content || '-';
    const length = item.width || 48;
    const line = char.repeat(length);

    let commands = Buffer.alloc(0);

    if (item.align) {
      const alignCode = item.align === 'center' ? 0x01 : item.align === 'right' ? 0x02 : 0x00;
      commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, alignCode])]);
    }

    commands = Buffer.concat([commands, Buffer.from(line + '\n', 'utf8')]);
    commands = Buffer.concat([commands, Buffer.from([0x1B, 0x61, 0x00])]);

    return commands;
  }

  #processSpaceItem(item) {
    const lines = item.lines || 1;
    let commands = Buffer.alloc(0);

    for (let i = 0; i < lines; i++) {
      commands = Buffer.concat([commands, Buffer.from('\n')]);
    }

    return commands;
  }

  #convertToMonochrome(canvas, threshold = 128) {
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

        const gray = (r + g + b) / 3;
        const isBlack = a > 128 && gray < threshold ? 1 : 0;
        row.push(isBlack);
      }
      bitmap.push(row);
    }

    return bitmap;
  }

  #convertBitmapToEscPos(bitmap, width, height) {
    const widthBytes = Math.ceil(width / 8);

    const xL = widthBytes & 0xFF;
    const xH = (widthBytes >> 8) & 0xFF;
    const yL = height & 0xFF;
    const yH = (height >> 8) & 0xFF;

    let commands = Buffer.from([0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH]);

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

  #parseStatusResponses(responses) {
    const status = {
      online: false,
      feedButtonEnabled: 'unknown',
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
          case 0:
            status.online = (byte & 0x08) === 0;
            status.coverOpen = (byte & 0x04) !== 0;
            break;
          case 1:
            status.coverOpen = status.coverOpen || (byte & 0x04) !== 0;
            break;
          case 2:
            if (byte & 0x08) status.errors.push('cutter_error');
            if (byte & 0x20) status.errors.push('unrecoverable_error');
            if (byte & 0x40) status.errors.push('auto_recoverable_error');
            break;
          case 3:
            status.paperPresent = (byte & 0x60) === 0;
            break;
        }
      }
    });

    return status;
  }
}

/**
 * Create a ThermalPrinterAdapter from environment config
 * @param {Object} [options]
 * @returns {ThermalPrinterAdapter}
 */
export function createThermalPrinterAdapter(options = {}) {
  const adapterConfig = configService.getAdapterConfig('thermal_printer') || {};
  const host = adapterConfig.host;
  const port = adapterConfig.port || 9100;

  return new ThermalPrinterAdapter({ host, port }, options);
}

export default ThermalPrinterAdapter;
