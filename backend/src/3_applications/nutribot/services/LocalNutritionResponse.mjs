/** Transport-free responses for devices and unconnected apps; never claims delivery. */
export function createLocalNutritionResponse() {
  let sequence = 0;
  const sendMessage = async () => ({ messageId: `local_${++sequence}`, delivered: false });
  return {
    available: false, sendMessage, sendPhoto: sendMessage,
    updateMessage: async () => {}, deleteMessage: async () => {},
    createStatusIndicator: async () => ({ finish: async () => {}, cancel: async () => {} }),
  };
}
