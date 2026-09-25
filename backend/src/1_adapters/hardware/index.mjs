/**
 * Hardware Adapters
 * @module adapters/hardware
 *
 * Adapters for hardware devices:
 * - Thermal printers (ESC/POS)
 * - Laser printer (IPP — kitchen Brother HL-L2460DW)
 * (Text-to-speech moved to adapters/ai/OpenAITTSAdapter — it is an OpenAI API client)
 * - MQTT sensors (vibration sensors)
 * - ePaper display (Seeed reTerminal E1004)
 */

export { ThermalPrinterAdapter, ThermalPrinterRegistry } from './thermal-printer/index.mjs';
export { LaserPrinterAdapter } from './laser-printer/index.mjs';
export { MQTTSensorAdapter } from './mqtt-sensor/index.mjs';
export { EpaperAdapter, EPAPER_PALETTE, EPAPER_WIDTH, EPAPER_HEIGHT } from './epaper/index.mjs';
export { PressureMatAdapter, PressureMatAdapterError } from './pressure-mat/index.mjs';
