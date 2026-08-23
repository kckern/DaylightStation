package net.kckern.pianobridge.api;

/**
 * Implemented BY a payload; called BY the shell.
 *
 * A payload is a .jar of classes.dex loaded at runtime with DexClassLoader. It holds
 * ALL bridge logic — MIDI, kiosk watchdog, settings guard, the :8770 control plane —
 * and is replaced over the LAN with zero tablet interaction. The shell (the installed
 * APK) holds only what Android freezes at install time: manifest entry points,
 * permissions, the a11y service declaration, and the native .so.
 *
 * Entry class name is FIXED: {@code net.kckern.pianobridge.payload.Main}. The shell
 * finds it by name; there is no registry.
 *
 * CONTRACT ON THROWING: if {@link #start} throws, the shell treats the payload as
 * broken and rolls back to the previous one. A payload must therefore do its own
 * defensive setup and only throw for "this payload cannot run at all".
 */
public interface Payload {
    /** Build everything, bind the control plane, open BLE. Called once per activation. */
    void start(ShellServices shell);

    /** Tear down cleanly. Called before a swap or shell shutdown. Must not throw. */
    void stop();

    /** Human-readable version, e.g. "p3-midi-write". Surfaced in GET /payload. */
    String version();

    /**
     * The shell OWNS the AccessibilityService instance (manifest-declared); the
     * payload OWNS what to do with it. Forwarded on bind/unbind so policy
     * (TouchPulser, L5 power-dialog restart) can live in the swappable half.
     * {@code svc} is an {@code android.accessibilityservice.AccessibilityService},
     * typed as Object here so this module stays free of Android deps.
     */
    void onAccessibilityConnected(Object svc);
    void onAccessibilityDisconnected();
}
