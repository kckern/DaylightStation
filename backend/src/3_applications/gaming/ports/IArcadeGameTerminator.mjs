/**
 * Ends play on a device and returns the screen to its normal state.
 *
 * This is the only destructive action in the arcade-game-session slice, and it is
 * genuinely destructive: stopping an emulator from outside cannot make it save
 * first, so whatever the player had not saved is lost. Nothing may call this
 * except budget expiry, and never without the warning ladder having run.
 */
export class IArcadeGameTerminator {
  /** @returns {Promise<{ok: boolean, error?: string}>} */
  async endPlay(_deviceId) { throw new Error('IArcadeGameTerminator.endPlay must be implemented'); }
}
