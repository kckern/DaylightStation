package net.kckern.audiobridge;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

public class MainActivity extends Activity {

    private static final String TAG = "AudioBridge";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Log.i(TAG, "MainActivity starting service");

        Intent serviceIntent = new Intent(this, AudioBridgeService.class);
        startForegroundService(serviceIntent);

        finish();
    }
}
