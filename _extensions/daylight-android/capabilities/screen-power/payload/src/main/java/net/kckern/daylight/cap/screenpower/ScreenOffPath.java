package net.kckern.daylight.cap.screenpower;

/**
 * How this device turns its display off, decided at each request. Pure Java.
 *
 *   an active device admin              DevicePolicyManager.lockNow()
 *   else a bound accessibility service  the lock-screen global action (Android 9 and later)
 *   else                                unsupported, with the reason
 *
 * The Shield has no device-admin feature, so only the second can ever apply there.
 */
final class ScreenOffPath {
    /** Build.VERSION_CODES.P: the first release with GLOBAL_ACTION_LOCK_SCREEN. */
    static final int ACCESSIBILITY_LOCK_SDK = 28;

    enum Kind { DEVICE_ADMIN, ACCESSIBILITY, NONE }

    static final class Choice {
        final Kind kind;
        /** Why there is no way, when kind is NONE; else null. */
        final String reason;
        Choice(Kind kind, String reason) { this.kind = kind; this.reason = reason; }
    }

    private ScreenOffPath() { }

    static Choice choose(boolean adminActive, boolean accessibilityBound, int sdkInt) {
        if (adminActive) return new Choice(Kind.DEVICE_ADMIN, null);
        if (sdkInt < ACCESSIBILITY_LOCK_SDK) return new Choice(Kind.NONE, "device admin required");
        if (accessibilityBound) return new Choice(Kind.ACCESSIBILITY, null);
        return new Choice(Kind.NONE, "device admin or a bound accessibility service required");
    }
}
