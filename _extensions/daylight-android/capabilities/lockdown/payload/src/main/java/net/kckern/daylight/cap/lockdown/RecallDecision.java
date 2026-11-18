package net.kckern.daylight.cap.lockdown;

import net.kckern.daylight.core.kiosk.AllowRules;

import java.util.Set;

/**
 * Should the kiosk be brought back to the front right now? Pure Java.
 * Fails closed: when the watcher cannot say what is in front, the answer is recall.
 */
final class RecallDecision {
    /** A window sample older than this is treated as no sample. */
    static final long FRESH_MS = 3_000L;
    /** android.view.Display.STATE_ON, copied so this class needs no Android. */
    static final int DISPLAY_ON = 2;
    /** Where Android's own Bluetooth pairing dialog lives. */
    static final String SETTINGS_PACKAGE = "com.android.settings";

    static final class Input {
        boolean locked;
        boolean screenOn;
        /** The kiosk Activity's own lifecycle says it is resumed. */
        boolean kioskResumed;
        /** The accessibility service is bound. */
        boolean watcherBound;
        /** The package whose application window THIS sample found active; null when it found none. */
        String front;
        /** Activity in front when known, else null. */
        String frontActivity;
        long sampleAgeMs;
        String ownPackage;
        AllowRules allow;
        Exemptions exemptions;
        long nowMs;
        /** When the kiosk first stopped being in front; 0 while it is in front. */
        long awaySinceMs;
        long graceMs;
        /** Packages a package gate has closed. They are never allowed in front. May be null. */
        Set<String> blocked;
        /** A pairing the kiosk page started is waiting on Android's own pairing dialog. */
        boolean pairingDialogAllowed;
        /** Android's keyguard is showing (KeyguardManager.isKeyguardLocked). */
        boolean keyguardShowing;
    }

    static final class Decision {
        final boolean recall;
        final String reason;
        Decision(boolean recall, String reason) { this.recall = recall; this.reason = reason; }
    }

    private RecallDecision() { }

    static Decision decide(Input in) {
        if (!in.locked) return new Decision(false, "unlocked");
        if (!in.screenOn) return new Decision(false, "display off");
        // What THIS sample saw. A sample that identified no application window, or one that
        // is old, or no watcher at all, is "unknown", never the last package that was seen.
        boolean known = in.watcherBound && in.front != null && in.sampleAgeMs <= FRESH_MS;
        if (known && !in.front.equals(in.ownPackage)) {
            // Another package's application window is the active one. This is decided
            // before the kiosk's own lifecycle is asked: on Android 10 and later every
            // visible activity is resumed, so with Settings beside the kiosk in split
            // screen the kiosk reads "resumed" while Settings is in use.
            // A closed package comes before the allowlist, every exemption and the grace period.
            if (in.blocked != null && in.blocked.contains(in.front)) return new Decision(true, "blocked: " + in.front);
            if (in.allow.matches(in.front, in.frontActivity) || in.exemptions.allows(in.front, in.frontActivity, in.nowMs)) {
                return new Decision(false, "allowed");
            }
            if (in.pairingDialogAllowed && SETTINGS_PACKAGE.equals(in.front)) return new Decision(false, "pairing dialog");
            // The grace period covers the kiosk leaving the front. Beside a resumed kiosk
            // there is nothing to wait for.
            if (!in.kioskResumed && in.graceMs > 0 && in.awaySinceMs > 0 && in.nowMs - in.awaySinceMs < in.graceMs) {
                return new Decision(false, "grace");
            }
            return new Decision(true, (in.kioskResumed ? "not allowed beside the kiosk: " : "not allowed: ") + in.front);
        }
        if (in.kioskResumed) return new Decision(false, "kiosk in front");
        // Android's own lock screen has no application window. Recalling over it does nothing.
        if (in.keyguardShowing) return new Decision(false, "keyguard");
        if (!known) return new Decision(true, "foreground unknown");
        // The sample says our own package and the Activity says it is not resumed: a
        // dialog of ours (the PIN prompt) or the moment between the two. Not an escape.
        return new Decision(false, "own package");
    }

    /**
     * Is the display on, from Display.getState()? A state that cannot be read (null)
     * counts as on: an unreadable display must not be a way to switch the watcher off.
     */
    static boolean screenOn(Integer displayState) {
        return displayState == null || displayState == DISPLAY_ON;
    }

    /** The away clock: starts when the kiosk first leaves the front, is not restarted by hopping, ends on return. */
    static long awaySince(long current, boolean kioskResumed, long nowMs) {
        if (kioskResumed) return 0;
        return current == 0 ? nowMs : current;
    }

    /** A recall that does not take is retried every tick; note the first and then every 30th. */
    static boolean shouldNote(int consecutiveRecalls) {
        return consecutiveRecalls == 1 || consecutiveRecalls % 30 == 0;
    }
}
