/**
 * Hardware Adapters
 * @module adapters/hardware
 *
 * Adapters for hardware devices:
 * - Thermal printers (ESC/POS)
 * - Text-to-speech (OpenAI TTS)
 * - MQTT sensors (vibration sensors)
 */

export { ThermalPrinterAdapter, createThermalPrinterAdapter } from './thermal-printer/index.mjs';
export { TTSAdapter, createTTSAdapter } from './tts/index.mjs';
export { MQTTSensorAdapter, createMQTTSensorAdapter } from './mqtt-sensor/index.mjs';
