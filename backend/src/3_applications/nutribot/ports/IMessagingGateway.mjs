// backend/src/3_applications/nutribot/ports/IMessagingGateway.mjs

/**
 * Port interface for messaging operations (Telegram-agnostic)
 * @interface IMessagingGateway
 */
export const IMessagingGateway = {
  async sendMessage(userId, text, options = {}) {},
  async sendPhoto(userId, imageBuffer, caption, options = {}) {},
  async sendKeyboard(userId, text, buttons, options = {}) {},
  async editMessage(userId, messageId, text, options = {}) {},
  async editKeyboard(userId, messageId, buttons) {},
  async deleteMessage(userId, messageId) {},
  async answerCallback(callbackId, text) {},
  async getFileUrl(fileId) {},
  async downloadFile(fileId) {}
};

export function isMessagingGateway(obj) {
  return (
    obj &&
    typeof obj.sendMessage === 'function' &&
    typeof obj.sendKeyboard === 'function' &&
    typeof obj.answerCallback === 'function'
  );
}
