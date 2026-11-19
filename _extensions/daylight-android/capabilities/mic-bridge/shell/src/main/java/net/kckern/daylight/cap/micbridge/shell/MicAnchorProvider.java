package net.kckern.daylight.cap.micbridge.shell;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

/**
 * Android 11 denies the microphone to a foreground service started from the
 * background (boot, or while another app owns the screen). audio-bridge's boot
 * receiver and activity put up a 1x1 overlay window before starting the service,
 * which makes the app count as visible. The shell's receiver and activity know
 * nothing of microphones, so the overlay goes up here: a ContentProvider is created
 * at process start, on the main thread, before any receiver or service runs.
 */
public final class MicAnchorProvider extends ContentProvider {
    @Override
    public boolean onCreate() {
        try {
            OverlayAnchor.ensure(getContext());
        } catch (Throwable t) {
            Log.w("AudioBridge", "overlay anchor failed at process start", t);
        }
        return true;
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
