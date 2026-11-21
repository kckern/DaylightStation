package net.kckern.daylight.cap.quickinput.shell;

/**
 * Whether the photo screen has to ask for the camera permission. Pure.
 *
 * A photo is taken by the system's camera app, through ACTION_IMAGE_CAPTURE, so this
 * app needs no camera of its own and the phone build does not declare CAMERA. Android's
 * rule for that intent: an app that does not declare CAMERA may use it freely; an app
 * that declares CAMERA must also hold it, or the intent is refused with a
 * SecurityException. So in a build that does declare it (a device that gives a page the
 * camera), the permission is asked for before the camera is opened.
 */
final class CameraAsk {
    static final String CAMERA = "android.permission.CAMERA";
    private static final int GRANTED = 0;      // PackageManager.PERMISSION_GRANTED

    private CameraAsk() { }

    /**
     * @param declared the permissions this build's manifest asks for (PackageInfo.requestedPermissions)
     * @param held     whether CAMERA is granted now
     */
    static boolean mustAsk(String[] declared, boolean held) {
        if (held || declared == null) return false;
        for (String p : declared) if (CAMERA.equals(p)) return true;
        return false;
    }

    enum Reply { IGNORE, OPEN, DENIED, RETRY }

    static Reply afterReply(boolean waiting, boolean granted, boolean ownerVerified) {
        if (!waiting) return Reply.IGNORE;
        if (!granted) return Reply.DENIED;
        return ownerVerified ? Reply.OPEN : Reply.RETRY;
    }

    /** Whether the dialog's answer gave the camera. */
    static boolean granted(String[] permissions, int[] results) {
        if (permissions == null || results == null) return false;
        for (int i = 0; i < permissions.length && i < results.length; i++) {
            if (CAMERA.equals(permissions[i])) return results[i] == GRANTED;
        }
        return false;
    }
}
