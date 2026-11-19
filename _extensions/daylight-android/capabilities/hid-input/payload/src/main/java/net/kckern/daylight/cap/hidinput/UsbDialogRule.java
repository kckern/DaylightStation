package net.kckern.daylight.cap.hidinput;

import java.util.Locale;

/**
 * Decides whether the window on screen is the system's USB permission dialog for
 * this app, and so may be confirmed on the user's behalf. Pure: the automator
 * gathers the three facts from Android and asks here.
 */
final class UsbDialogRule {
    /** The package Android's USB permission dialog (UsbPermissionActivity) belongs to. */
    static final String SYSTEM_UI = "com.android.systemui";

    private UsbDialogRule() { }

    /**
     * True only when the window belongs to the system UI, names this app's label as a
     * whole word (so "Daylight" does not match inside another app's longer name), and
     * speaks of a USB device.
     *
     * @param windowPackage package of the active window's root node
     * @param dialogText    every text and content description in the window, joined with spaces
     * @param appLabel      this app's label, read from the installed app at run time
     */
    static boolean isOwnUsbDialog(String windowPackage, String dialogText, String appLabel) {
        if (!SYSTEM_UI.equals(windowPackage)) return false;
        if (dialogText == null || !namesLabel(dialogText, appLabel)) return false;
        String lower = dialogText.toLowerCase(Locale.US);
        return lower.contains("usb") || lower.contains("device");
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
