package net.kckern.audiobridge;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

public class MainActivity extends Activity {

    private static final String TAG = "AudioBridge";
    private boolean serviceStarted = false;

    @Override
    protected void onResume() {
        super.onResume();

        if (serviceStarted) return;
        serviceStarted = true;

        Log.i(TAG, "MainActivity onResume — restarting service from foreground context");

        Intent serviceIntent = new Intent(this, AudioBridgeService.class);

        // Stop existing service first. It may have been started by BootReceiver
        // from a background context (createdFromFg=false), which blocks mic access
        // on Android 11+. Stopping and recreating it from this foreground Activity
        // gives it createdFromFg=true and allowWhileInUsePermissionInFgs=true.
        stopService(serviceIntent);
        startForegroundService(serviceIntent);
        Log.i(TAG, "Foreground service started from Activity");

        new Handler(Looper.getMainLooper()).postDelayed(this::finish, 1000);
    }
}
