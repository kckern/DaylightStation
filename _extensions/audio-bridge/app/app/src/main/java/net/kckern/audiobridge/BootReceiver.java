package net.kckern.audiobridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "AudioBridge";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            Log.i(TAG, "Boot completed — starting AudioBridgeService");
            final Context app = context.getApplicationContext();
            final PendingResult pending = goAsync();
            // Show the overlay first so the start counts as foreground (mic allowed).
            OverlayAnchor.ensure(app);
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                app.startForegroundService(new Intent(app, AudioBridgeService.class));
                pending.finish();
            }, OverlayAnchor.SETTLE_MS);
        }
    }
}
