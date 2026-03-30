/**
 * Hardware Adapters
 * @module adapters/hardware
 *
 * Adapters for hardware devices:
 * - Thermal printers (ESC/POS)
 * - Text-to-speech (OpenAI TTS)
 * - MQTT sensors (vibration sensors)
 * - ePaper display (Seeed reTerminal E1004)
 */

export { ThermalPrinterAdapter, createThermalPrinterAdapter } from './thermal-printer/index.mjs';
export { TTSAdapter, createTTSAdapter } from './tts/index.mjs';
export { MQTTSensorAdapter, createMQTTSensorAdapter } from './mqtt-sensor/index.mjs';
export { EpaperAdapter, EPAPER_PALETTE, EPAPER_WIDTH, EPAPER_HEIGHT } from './epaper/index.mjs';
