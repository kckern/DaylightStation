package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;

/**
 * Keep, for screens in capabilities that do not link media-service (the phone home): they
 * call {@link #keep} by name, so Keep runs where it was tapped, with its inline line,
 * rather than opening On this phone (audit: long-press Keep jumped to another screen).
 */
public final class KeepEntry {
    private KeepEntry() { }

    public static void keep(Activity activity, String mediaId, String title) {
        KeepFlow.start(activity, mediaId, title == null ? "" : title);
    }
}
