package net.kckern.daylight.core.spi;

/**
 * Provided by `bluetooth-controls`. True only while a pairing the user started
 * from the kiosk is waiting on Android's own pairing dialog. `lockdown` (phase 3)
 * must not recall the kiosk over that dialog.
 */
public interface PairingDialogExemption {
    boolean allowed();
}
