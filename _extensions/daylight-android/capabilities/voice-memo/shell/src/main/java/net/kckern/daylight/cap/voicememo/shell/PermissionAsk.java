package net.kckern.daylight.cap.voicememo.shell;

import java.util.ArrayList;
import java.util.List;

/**
 * Which permissions the record screen asks for. Pure.
 *
 * The microphone is asked for whenever it is missing. Notifications (Android 13 and
 * later) are asked for once, here, the first time the owner makes a memo: they are
 * how a memo that is waiting or could not be sent is reported. Nothing is asked at
 * install, and a "no" is not asked again. Recording does not depend on the answer.
 */
final class PermissionAsk {
    static final String MIC = "android.permission.RECORD_AUDIO";
    static final String NOTIFICATIONS = "android.permission.POST_NOTIFICATIONS";
    private static final int GRANTED = 0;      // PackageManager.PERMISSION_GRANTED

    private PermissionAsk() { }

    static String[] toRequest(int sdk, boolean micGranted, boolean notificationsGranted, boolean askedNotificationsBefore) {
        List<String> out = new ArrayList<>();
        if (!micGranted) out.add(MIC);
        if (sdk >= 33 && !notificationsGranted && !askedNotificationsBefore) out.add(NOTIFICATIONS);
        return out.toArray(new String[0]);
    }

    static boolean asksForNotifications(String[] requested) {
        for (String p : requested) if (NOTIFICATIONS.equals(p)) return true;
        return false;
    }

    /** Whether the microphone may be used after the dialog's answer. */
    static boolean micGranted(String[] permissions, int[] results, boolean grantedBefore) {
        if (grantedBefore) return true;
        if (permissions == null || results == null) return false;
        for (int i = 0; i < permissions.length && i < results.length; i++) {
            if (MIC.equals(permissions[i])) return results[i] == GRANTED;
        }
        return false;
    }
}
