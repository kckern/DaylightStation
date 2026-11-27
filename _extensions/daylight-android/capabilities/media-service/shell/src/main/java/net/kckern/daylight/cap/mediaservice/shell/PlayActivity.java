package net.kckern.daylight.cap.mediaservice.shell;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

/**
 * Starts playback of one media id (string extra "id", optional "title") by opening Now
 * playing, which shows the item starting from its first frame and starts it on its own
 * controller (Starting.EXTRA_PLAY). Not exported: only this app (a payload handling a keyed
 * media link) starts it.
 *
 * It used to be an invisible screen of its own that connected a controller, ate taps over
 * Now playing for up to eight seconds and then said "Could not start playback" while the
 * start was still going. It is kept only so a payload that still names it keeps working;
 * current payloads open Now playing directly.
 */
public class PlayActivity extends Activity {
    private static final String TAG = "Daylight-Media";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent in = getIntent();
        String mediaId = ControllerPolicy.playRequest(in == null ? null : in.getStringExtra("id"));
        if (mediaId != null) {
            String title = in.getStringExtra("title");
            Intent now = Starting.put(new Intent(this, NowPlayingActivity.class), mediaId, title, "", "")
                    .putExtra(NowPlayingActivity.EXTRA_TARGET, NowPlayingActivity.LOCAL)
                    .putExtra(Starting.EXTRA_ID, mediaId)
                    .putExtra(Starting.EXTRA_PLAY, true)
                    .putExtra(Starting.EXTRA_LONG, in.getBooleanExtra("long", false))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try { startActivity(now); }
            catch (RuntimeException refused) { Log.w(TAG, "play: Now playing did not open: " + refused.getClass().getSimpleName()); }
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
