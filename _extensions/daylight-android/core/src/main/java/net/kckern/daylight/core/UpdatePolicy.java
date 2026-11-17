package net.kckern.daylight.core;

import java.util.regex.Pattern;

/**
 * The decisions behind POST /update, as pure functions. The APK is fetched over
 * plain HTTP from an address the caller names, so nothing about it is taken on
 * trust: it must be this app, not older than what is installed, and, when the
 * caller says what it should hash to, exactly that file.
 */
final class UpdatePolicy {
    /** How long a committed install may wait for its confirmation before GET /update calls it failed. */
    static final long CONFIRM_WINDOW_MS = 90_000L;

    /**
     * The longest the system installer may be in front of a locked kiosk for one update:
     * writing the verified APK into the install session, then the confirmation window.
     * Granted only once the download is staged and verified, because the dialog appears
     * the moment the session is committed, and withdrawn as soon as the update fails or
     * the window runs out. The time limit is the backstop for an update whose end
     * nobody asks about.
     */
    static final long INSTALLER_EXEMPT_MS = CONFIRM_WINDOW_MS + 30_000L;

    private static final Pattern SHA256 = Pattern.compile("[0-9a-fA-F]{64}");

    private UpdatePolicy() { }

    static boolean wellFormedSha256(String sha256) { return sha256 != null && SHA256.matcher(sha256).matches(); }

    /**
     * Null when the download may go on, otherwise why it is refused.
     * @param expected what the caller said the APK hashes to, or null when it said nothing
     * @param actual   the sha256 of what was downloaded
     */
    static String shaRefusal(String expected, String actual) {
        if (expected == null) return null;
        if (actual != null && expected.equalsIgnoreCase(actual)) return null;
        return "sha256_mismatch: expected " + expected.toLowerCase(java.util.Locale.ROOT) + ", the download is " + actual;
    }

    /**
     * Null when the staged APK may be installed, otherwise why it is refused.
     * @param apkPackage the package the APK declares, or null when it could not be read as an APK
     */
    static String apkRefusal(String apkPackage, long apkVersionCode, String ownPackage, long installedVersionCode) {
        if (apkPackage == null) return "not_an_apk: the download could not be read as an Android package";
        if (!apkPackage.equals(ownPackage)) {
            return "wrong_package: the APK is " + apkPackage + ", this app is " + ownPackage;
        }
        if (apkVersionCode < installedVersionCode) {
            return "older_version: the APK is versionCode " + apkVersionCode + ", installed is " + installedVersionCode;
        }
        return null;
    }

    /**
     * Whether the system's confirmation dialog may be tapped on the user's behalf.
     * Only for an APK the caller identified by hash and that matched: without a hash
     * the install still reaches the dialog, and a person decides.
     */
    static boolean mayAutoConfirm(boolean autoConfirmSetting, boolean sha256SuppliedAndVerified) {
        return autoConfirmSetting && sha256SuppliedAndVerified;
    }

    /**
     * True when an install that was committed at committedAtMs has waited past the
     * window. A confirmed install replaces this process, so a process that is still
     * here after the window was not updated: the dialog was dismissed, or it failed.
     */
    static boolean confirmationExpired(long committedAtMs, long nowMs) {
        return nowMs - committedAtMs > CONFIRM_WINDOW_MS;
    }
}
