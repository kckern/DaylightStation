package net.kckern.daylight.core.spi;

/**
 * One configured Bluetooth link owned by a capability: the piano's BLE-MIDI link
 * (profile "midi", from `midi-bridge`) or its speaker (profile "audio", from
 * `audio-guard`). `bluetooth-controls` shows and re-points these without knowing
 * the classes behind them.
 */
public interface BluetoothRole {
    String profile();

    /** The configured address, upper case, or "" when none. */
    String address();

    String name();

    boolean enabled();

    /** False while the owning capability has no connector running. */
    boolean present();

    boolean connectedTo(String address);

    /** The address connected right now, or "". */
    String connectedAddress();

    /** Ask the existing connector to connect. No teardown. */
    void nudge();

    /** Point the role at a device, enable it, and rebuild the connector. */
    void assign(String address, String name);

    /** Record a new name for the same device. No teardown. */
    void rename(String name);

    /** Turn the role off and drop the link. */
    void disable();

    /** Stop scanning so a pairing can run. True when scanning is stopped or the role never scans. */
    boolean pauseDiscovery();

    void resumeDiscovery();
}
