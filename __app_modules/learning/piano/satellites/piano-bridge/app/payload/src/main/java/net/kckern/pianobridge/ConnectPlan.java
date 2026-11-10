package net.kckern.pianobridge;

import java.util.Locale;

/**
 * ConnectPlan — what a Bluetooth-panel "connect" should actually do.
 *
 * A connect used to always rewrite the config override and call
 * reloadConfigAndReconnect(), which tears down BOTH the A2DP connector and BLE-MIDI.
 * On 2026-10-23 18:04 a tap on the already-connected piano speaker did exactly that and
 * the speaker never came back. Only a real change of device (or re-enabling a disabled
 * role) needs the rebuild; the same device just needs nothing, or a nudge.
 */
public final class ConnectPlan {

    public enum Action { NOOP, NUDGE, RELOAD }

    private ConnectPlan() { }

    /**
     * @param profile        "audio" or "midi"
     * @param address        the device the panel asked for
     * @param configuredMac  the MAC currently configured for that role
     * @param roleEnabled    bluetoothAudioEnabled / bluetoothMidiEnabled
     * @param connected      that role is connected to {@code address} right now
     * @param connectorPresent the role's connector exists (a nudge needs something to nudge)
     */
    public static Action decide(String profile, String address, String configuredMac,
                                boolean roleEnabled, boolean connected, boolean connectorPresent) {
        boolean same = norm(address).equals(norm(configuredMac)) && !norm(address).isEmpty();
        if (!same || !roleEnabled || !connectorPresent) return Action.RELOAD;
        return connected ? Action.NOOP : Action.NUDGE;
    }

    private static String norm(String mac) { return mac == null ? "" : mac.trim().toUpperCase(Locale.US); }
}
