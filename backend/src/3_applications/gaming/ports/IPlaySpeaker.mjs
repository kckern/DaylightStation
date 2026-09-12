/**
 * Says something out loud on a device.
 *
 * A child absorbed in a game hears a warning sooner than they read one, and the
 * spoken channel works even when they are not looking at the part of the screen
 * the overlay occupies. Best-effort: failing to speak must never block the
 * warning it accompanies, nor the expiry that follows.
 */
export class IPlaySpeaker {
  async say(_deviceId, _text) { throw new Error('IPlaySpeaker.say must be implemented'); }
}
