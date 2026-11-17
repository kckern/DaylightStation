package net.kckern.daylight.core.spi;

/** Provided by `lockdown`. */
public interface LockdownControl {
    boolean locked();

    /** Package in front per the last fresh sample, or null when unknown. */
    String front();

    /** Class of the resumed activity per the last fresh sample, or null when unknown. */
    String frontActivity();

    /** The last package seen in front other than the kiosk, or null. */
    String lastAway();

    /** Allow a package until it has been in front and left again. */
    void allowWhileInFront(String packageName);

    /** Allow a rule (AllowRules syntax) for a limited time. Capped at one hour. */
    void allowFor(String rule, long durationMs);

    /** End every timed exemption granted for exactly this rule, before its time is up. Unknown rules are ignored. */
    void revoke(String rule);

    /** Bring the kiosk to the front and wait up to waitMs. True when the kiosk Activity is resumed. */
    boolean recall(long waitMs);
}
