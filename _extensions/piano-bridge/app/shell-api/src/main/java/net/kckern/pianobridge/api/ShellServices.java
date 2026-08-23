package net.kckern.pianobridge.api;

import java.io.File;

/**
 * Implemented BY the shell; handed TO the payload in {@link Payload#start}.
 *
 * Deliberately dumb. Everything the payload needs from Android it gets from
 * {@link #context()} — getSystemService, files, broadcasts. The shell has NO opinion
 * about MIDI, kiosks, or FKB; it only owns the handles Android binds to the
 * installed package. Keep this interface small: every method here is a promise the
 * shell must keep across every future payload.
 */
public interface ShellServices {
    /** The foreground Service's Context (an {@code android.content.Context}). */
    Object context();

    /** Foreground notification text. The notification itself is shell-owned. */
    void updateNotification(String text);

    /** The JNI synth facade ({@code net.kckern.pianobridge.PianoEngine}); .so is shell-side. */
    Object engine();

    /** Currently bound AccessibilityService instance, or null. */
    Object accessibilityService();

    /** The installed APK's versionCode — so a payload can refuse a shell too old for it. */
    int shellVersionCode();

    /** Directory payloads live in. A payload may write its own state beneath it. */
    File payloadDir();

    /**
     * Ask the shell to fetch + verify + activate a new payload. Lets a payload's own
     * control plane expose POST /payload without the shell hosting HTTP itself.
     * @param sha256 required; the shell refuses unverified drops.
     * @return a status string for the caller; the swap itself is asynchronous.
     */
    String requestPayloadSwap(String url, String sha256);

    /** Roll back to the previous payload, if any. Asynchronous. */
    String requestPayloadRollback();

    /** Status snapshot as a JSON string: current, previous, available, boots, lastError. */
    String payloadStatusJson();

    /** Durable one-line note into the shell's crash/boot log (survives payload swaps). */
    void note(String kind, String msg);
}
