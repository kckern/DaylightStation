/** Synthetic logging and WebSocket transport only; product and context stay real. */
const messages = new Set();
const statuses = new Set();
const logger = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() {
    return this;
  },
  sampled() {}
};
export default function getLogger() {
  return logger;
}
export function getChildLogger() {
  return logger;
}
export const wsService = {
  subscribe(topics, callback) {
    messages.add(callback);
    return () => messages.delete(callback);
  },
  onStatusChange(callback) {
    statuses.add(callback);
    return () => statuses.delete(callback);
  }
};
export function emit(payload) {
  for (const callback of messages) callback(payload);
}
export function subscriptions() {
  return {
    messages: messages.size,
    statuses: statuses.size
  };
}
