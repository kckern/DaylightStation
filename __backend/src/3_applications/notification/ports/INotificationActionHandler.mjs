/**
 * Port: an app that owns some notification actions (DoNow approvals,
 * supervision). It claims action ids by its own prefix and decides the press.
 */
export class INotificationActionHandler {
  /** @param {string} actionId @returns {boolean} */
  matches(actionId) { throw new Error('INotificationActionHandler.matches must be implemented'); }
  /**
   * @param {{notificationId:string, actionId:string, reply:string|null, username:string|null}} press
   * @returns {Promise<{ok:boolean, code?:string}>}
   */
  async handle(press) { throw new Error('INotificationActionHandler.handle must be implemented'); }
}

export function isNotificationActionHandler(obj) {
  return !!obj && typeof obj.matches === 'function' && typeof obj.handle === 'function';
}
