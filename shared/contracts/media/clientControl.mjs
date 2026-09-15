import { validateCommandEnvelope } from './envelopes.mjs';

const isString = (value) => typeof value === 'string' && value.length > 0;
const result = (errors) => ({ valid: errors.length === 0, errors });

export function controlTargetFromTopic(topic) {
  if (typeof topic !== 'string' || !topic.startsWith('client-control:')) return null;
  const target = topic.slice('client-control:'.length);
  return isString(target) ? target : null;
}

export function validateClientControlMessage(message) {
  const errors = [];
  if (!message || typeof message !== 'object') return result(['ClientControl: not an object']);
  if (!controlTargetFromTopic(message.topic)) errors.push('topic: required client-control target');
  if (!isString(message.replyToControlClientId)) errors.push('replyToControlClientId: required string');
  const envelope = validateCommandEnvelope(message);
  errors.push(...envelope.errors);
  return result(errors);
}

export function validateClientAck(message) {
  const errors = [];
  if (!message || typeof message !== 'object') return result(['ClientAck: not an object']);
  if (message.topic !== 'client-ack') errors.push('topic: must be "client-ack"');
  if (!isString(message.clientId)) errors.push('clientId: required string');
  if (!isString(message.replyToControlClientId)) errors.push('replyToControlClientId: required string');
  if (!isString(message.commandId)) errors.push('commandId: required string');
  if (typeof message.ok !== 'boolean') errors.push('ok: required boolean');
  for (const key of ['error', 'code', 'appliedAt']) {
    if (message[key] !== undefined && !isString(message[key])) errors.push(`${key}: must be string when present`);
  }
  const allowed = new Set(['topic', 'clientId', 'replyToControlClientId', 'commandId', 'ok', 'error', 'code', 'appliedAt']);
  for (const key of Object.keys(message)) {
    if (!allowed.has(key)) errors.push(`unexpected field: ${key}`);
  }
  return result(errors);
}
