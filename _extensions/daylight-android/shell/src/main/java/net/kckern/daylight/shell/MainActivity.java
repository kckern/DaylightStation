package net.kckern.daylight.shell;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/** Starts the service and leaves. Phase 3's kiosk activity lives in the webview-host capability. */
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startForegroundService(new Intent(this, ShellService.class));
        finish();
    }
}
