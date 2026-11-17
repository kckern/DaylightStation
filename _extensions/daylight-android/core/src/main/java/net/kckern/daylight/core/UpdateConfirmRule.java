package net.kckern.daylight.core;

/**
 * Decides whether the dialog on screen may be confirmed on the user's behalf.
 * Pure: OwnUpdateConfirmation gathers the facts from Android and asks here.
 *
 * Every condition must hold. The dialog itself does not say which install session
 * it belongs to, so the rule ties the tap to this app three ways: an update this
 * app started is pending, the session it created still exists and installs this
 * package, and the system installer's dialog names this app's label.
 */
final class UpdateConfirmRule {
    private UpdateConfirmRule() { }

    /** The package names the platform's installer UI ships under. */
    private static final String[] INSTALLERS = {
            "com.android.packageinstaller",
            "com.google.android.packageinstaller",
    };

    static final class Facts {
        /** A confirmation was begun by this app's own POST /update and has not finished. */
        boolean pending;
        long nowMs;
        long deadlineMs;
        /** Package of the window on screen. */
        String dialogPackage;
        /** That package is part of the system image (ApplicationInfo.FLAG_SYSTEM). */
        boolean dialogPackageIsSystemApp;
        /** Every text and content description in the window, joined with spaces. */
        String dialogText;
        /** This app's label, exactly as the launcher shows it. */
        String appLabel;
        String ownPackage;
        /** The install session this app committed is still known to the system. */
        boolean sessionFound;
        /** Who created that session. */
        String sessionInstallerPackage;
        /** Which package that session installs. */
        String sessionAppPackage;
    }

    /** Null to approve, otherwise why not. */
    static String refusal(Facts f) {
        if (!f.pending) return "not_pending";
        if (f.nowMs > f.deadlineMs) return "expired";
        if (!isInstaller(f.dialogPackage)) return "not_installer";
        if (!f.dialogPackageIsSystemApp) return "not_system_app";
        if (!f.sessionFound) return "no_session";
        if (f.ownPackage == null || !f.ownPackage.equals(f.sessionInstallerPackage)) return "session_not_ours";
        if (!f.ownPackage.equals(f.sessionAppPackage)) return "session_targets_other_package";
        String text = f.dialogText == null ? "" : f.dialogText;
        if (!namesLabel(text, f.appLabel)) return "label_not_named";
        String lower = text.toLowerCase(java.util.Locale.US);
        if (lower.contains("uninstall") || !(lower.contains("install") || lower.contains("update"))) return "not_install_dialog";
        return null;
    }

    private static boolean isInstaller(String packageName) {
        for (String p : INSTALLERS) if (p.equals(packageName)) return true;
        return false;
    }

    /** The label, case and all, with no letter or digit touching either end. */
    static boolean namesLabel(String text, String label) {
        if (text == null || label == null || label.trim().isEmpty()) return false;
        String want = label.trim();
        int from = 0;
        while (true) {
            int at = text.indexOf(want, from);
            if (at < 0) return false;
            int end = at + want.length();
            boolean startsWord = at == 0 || !Character.isLetterOrDigit(text.charAt(at - 1));
            boolean endsWord = end == text.length() || !Character.isLetterOrDigit(text.charAt(end));
            if (startsWord && endsWord) return true;
            from = at + 1;
        }
    }
}
