package net.kckern.daylight.api;

import java.io.File;

/**
 * Implemented by the shell, handed to the payload in Payload.start().
 * Keep it small: every method is a promise the shell keeps for every future payload.
 */
public interface ShellServices {
    /** The shell service's android.content.Context. */
    Object context();

    String deviceId();

    int shellVersionCode();

    /** The secret every control API request must present. */
    String controlToken();

    /**
     * The device's bearer token for the backend's command inbox (a phone polled for Play-on
     * and Keep commands); "" when the build holds none. Default: none, for shells older
     * than the inbox.
     */
    default String inboxToken() { return ""; }

    /** Directory payloads live in. A payload may keep its own state beneath it. */
    File payloadDir();

    /**
     * A shell-owned object by name (for example "accessibility" or "synth-engine"),
     * or null when absent. Replaces one getter per capability.
     */
    Object component(String name);

    void updateNotification(String text);

    /** Fetch, verify and activate a new payload. sha256 is required. Asynchronous. */
    String requestPayloadSwap(String url, String sha256);

    String requestPayloadRollback();

    /** Stop and start the current payload in place, with no fetch. Asynchronous. */
    String requestPayloadRestart();

    /** JSON: current, previous, available, boots, lastError. */
    String payloadStatusJson();

    /** One durable line in the shell log, which survives payload swaps. */
    void note(String kind, String message);
}
