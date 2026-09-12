/**
 * Tells a responsible adult that the meter cannot see.
 *
 * This exists because of a deliberate gap in the design: the system will not
 * stop a game it cannot observe (killing blind is worse than mis-billing), but
 * going blind must not therefore become a way to play forever. When blindness
 * outlasts the time that was granted, the escalation is to a person — not to a
 * kill switch.
 */
export class IPlaySupervisorAlert {
  /**
   * @param {Object} _alert
   * @param {string} _alert.deviceId
   * @param {string} _alert.condition
   * @param {string} _alert.message  Plain language, for a phone screen.
   */
  async raise(_alert) { throw new Error('IPlaySupervisorAlert.raise must be implemented'); }
}
