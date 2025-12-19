/**
 * NutriBot Handlers barrel export
 * @module nutribot/handlers
 * 
 * Note: Webhook handling now uses createTelegramWebhookHandler from
 * adapters/http/TelegramWebhookHandler.mjs (see server.mjs)
 */

export { nutribotReportHandler } from './report.mjs';
export { nutribotReportImgHandler } from './reportImg.mjs';
export { directUPCHandler, directImageHandler, directTextHandler } from './directInput.mjs';
