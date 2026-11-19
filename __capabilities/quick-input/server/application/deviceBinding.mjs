/**
 * Which household device may send quick inputs for which user.
 * @module quick-input/application/deviceBinding
 *
 * The binding is on the device's entry in the household devices file:
 *
 *   quick_input:
 *     journalist: [<username>, ...]
 *     nutribot: [<username>, ...]
 *
 * `voice_memo.users`, the shape the Journalist voice intake started with,
 * still binds a device for Journalist voice.
 */

const DEVICE_ID = /^fleet:([A-Za-z0-9._-]{1,96})$/;

const list = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []);

/**
 * The users a device entry is bound to for one bot and kind.
 * @param {Object|null|undefined} deviceConfig - The device's entry
 * @param {string} bot - 'journalist' | 'nutribot'
 * @param {string} kind - 'voice' | 'text' | 'photo'
 * @returns {string[]}
 */
export function boundUsers(deviceConfig, bot, kind) {
  const block = deviceConfig?.quick_input;
  const users = block && typeof block === 'object' && Object.hasOwn(block, bot) ? list(block[bot]) : [];
  const earlier = bot === 'journalist' && kind === 'voice' ? list(deviceConfig?.voice_memo?.users) : [];
  return [...new Set([...users, ...earlier])];
}

/**
 * Whether the device a request names may send for `username`.
 * `deviceId` is the `X-Daylight-Device` value. Only a registered household
 * device (`fleet:<key>`) that lists the user qualifies; a browser id, an
 * unknown key or a device with no list does not.
 * @param {string} deviceId
 * @param {string} username
 * @param {(deviceKey: string) => string[]|undefined} usersForDevice
 */
export function isBoundDevice(deviceId, username, usersForDevice) {
  const match = DEVICE_ID.exec(String(deviceId ?? ''));
  if (!match || !username || typeof usersForDevice !== 'function') return false;
  const users = usersForDevice(match[1]);
  return Array.isArray(users) && users.includes(username);
}
