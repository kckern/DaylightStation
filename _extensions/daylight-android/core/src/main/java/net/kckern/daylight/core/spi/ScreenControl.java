package net.kckern.daylight.core.spi;

/**
 * Provided by `screen-power`. The fuller interface the kiosk uses; ScreenPower is the
 * two-method form `volume-keys` consumes, and `screen-power` provides both.
 */
public interface ScreenControl {
    /** Display.getState() == STATE_ON. */
    boolean isOn();

    /** False when this device has no way to turn its display off (no device admin, no bound accessibility service). */
    boolean canTurnOff();

    /** Change the display state and wait up to waitMs. Returns the state read back. */
    boolean setOn(boolean on, long waitMs);

    /** Wake the display if the cooldown and the no-wake window allow. Cheap; safe on a MIDI thread. */
    void poke();
}
