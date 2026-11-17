package net.kckern.daylight.cap.synth.shell;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.util.Log;

import net.kckern.daylight.api.ShellComponents;

/**
 * Creates the native engine once per process and publishes it for the payload.
 * The engine outlives payload swaps, as it did when the piano-bridge service owned it.
 * Not a data provider: a ContentProvider is how a library runs code at process start.
 */
public final class SynthEngineProvider extends ContentProvider {
    public static final String COMPONENT = "synth-engine";
    /**
     * Published instead of, or beside, the engine when it could not be set up: the
     * class name of what was thrown, or "init_failed". The payload reports it in
     * GET /status, so a missing native library does not look like an idle synth.
     */
    public static final String ERROR_COMPONENT = "synth-engine-error";
    private static final String TAG = "PianoBridge";

    @Override
    public boolean onCreate() {
        try {
            PianoEngine engine = new PianoEngine();
            if (!engine.init()) {
                Log.e(TAG, "PianoEngine.init failed");
                ShellComponents.publish(ERROR_COMPONENT, "init_failed");
            }
            // Published either way, as before: every engine method is a no-op without a handle.
            ShellComponents.publish(COMPONENT, engine);
        } catch (Throwable t) {
            // Includes UnsatisfiedLinkError. A missing library must not stop the shell.
            Log.e(TAG, "synth engine unavailable", t);
            ShellComponents.publish(ERROR_COMPONENT, t.getClass().getName());
        }
        return true;
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) { return null; }
    @Override public String getType(Uri uri) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String selection, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { return 0; }
}
