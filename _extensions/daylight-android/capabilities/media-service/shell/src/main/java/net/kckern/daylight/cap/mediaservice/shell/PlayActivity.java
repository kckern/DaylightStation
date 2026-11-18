package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.content.ComponentName;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.google.common.util.concurrent.ListenableFuture;

/**
 * Starts playback of one media id (string extra "id") through a MediaController, the
 * way Media3 expects playback to be started from the foreground. Not exported: only
 * this app (the payload, handling a keyed media link) can start it. The service
 * resolves the id through the payload, so this screen never sees a stream URL.
 *
 * It has no window of its own to look at. It stays up until playback has started,
 * failed, or eight seconds have passed, because Android lets a service become a
 * foreground service only while the app is visible.
 */
public class PlayActivity extends Activity {
    private static final String TAG = "Daylight-Media";
    private static final long GIVE_UP_MS = 8000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private ListenableFuture<MediaController> pending;
    private MediaController controller;
    private boolean done;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        final String mediaId = ControllerPolicy.playRequest(getIntent() == null ? null : getIntent().getStringExtra("id"));
        if (mediaId == null) { finish(); return; }
        main.postDelayed(() -> end("Could not start playback"), GIVE_UP_MS);
        try {
            SessionToken token = new SessionToken(this, new ComponentName(this, DaylightMediaService.class));
            pending = new MediaController.Builder(this, token).buildAsync();
            pending.addListener(() -> {
                try {
                    controller = pending.get();
                    controller.addListener(new Player.Listener() {
                        @Override public void onIsPlayingChanged(boolean isPlaying) { if (isPlaying) end(null); }
                        @Override public void onPlayerError(PlaybackException error) { end("Could not start playback"); }
                    });
                    controller.setMediaItem(new MediaItem.Builder().setMediaId(mediaId).build());
                    controller.prepare();
                    controller.play();
                } catch (Exception e) {
                    Log.w(TAG, "no media controller: " + e.getClass().getSimpleName());
                    end("Could not start playback");
                }
            }, main::post);
        } catch (RuntimeException e) {
            Log.w(TAG, "could not reach the media service: " + e.getClass().getSimpleName());
            end("Could not start playback");
        }
    }

    /** Once. @param message shown when not null */
    private void end(String message) {
        if (done) return;
        done = true;
        main.removeCallbacksAndMessages(null);
        if (message != null) Toast.makeText(getApplicationContext(), message, Toast.LENGTH_SHORT).show();
        finish();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        // Releasing the controller does not stop playback: the session keeps the player.
        if (controller != null) { controller.release(); controller = null; }
        else if (pending != null) MediaController.releaseFuture(pending);
        super.onDestroy();
    }
}
