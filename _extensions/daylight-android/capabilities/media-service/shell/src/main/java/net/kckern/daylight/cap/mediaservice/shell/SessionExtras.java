package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Bundle;

import androidx.media3.session.MediaSession;

/**
 * The phone session's extras, merged: Media3 1.1.1 has no getter, and setSessionExtras
 * replaces the whole bundle, so every writer (the sleep timer, a refused play) goes through
 * here and keeps the others' keys.
 */
final class SessionExtras {
    private static final Bundle current = new Bundle();

    private SessionExtras() { }

    static synchronized void putLong(MediaSession session, String key, long value) {
        current.putLong(key, value);
        publish(session);
    }

    static synchronized void putLongAndString(MediaSession session, String key, long value, String key2, String value2) {
        current.putLong(key, value);
        current.putString(key2, value2);
        publish(session);
    }

    static synchronized void remove(MediaSession session, String key) {
        current.remove(key);
        publish(session);
    }

    private static void publish(MediaSession session) {
        if (session != null) session.setSessionExtras(new Bundle(current));
    }
}
