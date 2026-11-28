package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.content.ComponentName;
import android.os.Bundle;
import android.support.v4.media.MediaBrowserCompat;
import android.util.Log;

import androidx.media3.session.LibraryResult;
import androidx.media3.session.MediaBrowser;
import androidx.media3.session.SessionToken;

import java.util.List;

/**
 * Debug builds only. A real subscribed browser for checking that a keep saved, ready or
 * removed reaches one: it connects two browsers to the media service, as Android Auto
 * would (the legacy {@code MediaBrowserCompat}, which Auto uses) and as a Media3 client
 * would, subscribes both to the parents named in the {@code parents} extra (default
 * "kept,root"), and logs every callback under the tag {@code Daylight-Probe}.
 *
 * <pre>adb shell am start -n .../.SubscriberProbeActivity --es parents kept,root</pre>
 */
public final class SubscriberProbeActivity extends Activity {
    private static final String TAG = "Daylight-Probe";
    private MediaBrowserCompat legacy;
    private MediaBrowser modern;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String raw = getIntent().getStringExtra("parents");
        final String[] parents = (raw == null || raw.isEmpty() ? "kept,root" : raw).split(",");
        ComponentName service = new ComponentName(this, DaylightMediaService.class);

        legacy = new MediaBrowserCompat(this, service, new MediaBrowserCompat.ConnectionCallback() {
            @Override public void onConnected() {
                Log.i(TAG, "compat connected");
                for (String p : parents) {
                    final String parent = p;
                    legacy.subscribe(parent, new MediaBrowserCompat.SubscriptionCallback() {
                        @Override public void onChildrenLoaded(String id, List<MediaBrowserCompat.MediaItem> children) {
                            Log.i(TAG, "compat onChildrenLoaded " + id + " n=" + children.size());
                        }
                        @Override public void onError(String id) { Log.i(TAG, "compat error " + id); }
                    });
                    Log.i(TAG, "compat subscribed " + parent);
                }
            }
            @Override public void onConnectionFailed() { Log.i(TAG, "compat connection failed"); }
        }, null);
        legacy.connect();

        SessionToken token = new SessionToken(this, service);
        MediaBrowser.Builder b = new MediaBrowser.Builder(this, token).setListener(new MediaBrowser.Listener() {
            @Override public void onChildrenChanged(MediaBrowser browser, String parentId, int itemCount,
                                                    androidx.media3.session.MediaLibraryService.LibraryParams params) {
                Log.i(TAG, "media3 onChildrenChanged " + parentId + " n=" + itemCount);
            }
        });
        final com.google.common.util.concurrent.ListenableFuture<MediaBrowser> future = b.buildAsync();
        future.addListener(() -> {
            try {
                modern = future.get();
                Log.i(TAG, "media3 connected");
                for (String p : parents) {
                    final String parent = p;
                    final com.google.common.util.concurrent.ListenableFuture<LibraryResult<Void>> sub = modern.subscribe(parent, null);
                    sub.addListener(() -> {
                        try {
                            Log.i(TAG, "media3 subscribe " + parent + " -> resultCode " + sub.get().resultCode);
                        } catch (Exception e) { Log.i(TAG, "media3 subscribe " + parent + " failed " + e); }
                    }, getMainExecutor());
                }
            } catch (Exception e) {
                Log.i(TAG, "media3 connection failed " + e);
            }
        }, getMainExecutor());
    }

    @Override
    protected void onDestroy() {
        if (legacy != null) legacy.disconnect();
        if (modern != null) modern.release();
        super.onDestroy();
    }
}
