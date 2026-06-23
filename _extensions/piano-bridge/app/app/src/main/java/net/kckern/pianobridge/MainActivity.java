package net.kckern.pianobridge;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * MainActivity — minimal status/control surface. The kiosk drives everything
 * over the WebSocket; this screen exists only to launch the service on first
 * install and offer a manual restart button for debugging.
 */
public class MainActivity extends Activity {

    private static final String TAG = "PianoBridge";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        root.setPadding(pad, pad, pad, pad);

        TextView status = new TextView(this);
        status.setText("Piano Bridge running — control via kiosk");
        status.setGravity(Gravity.CENTER);
        status.setTextSize(18f);
        root.addView(status);

        Button restart = new Button(this);
        restart.setText("Restart service");
        restart.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Log.i(TAG, "Manual restart requested from MainActivity");
                startBridgeService(true);
            }
        });
        root.addView(restart);

        setContentView(root);

        // Auto-start the service on launch (e.g. after first install).
        startBridgeService(false);
    }

    private void startBridgeService(boolean restart) {
        Intent serviceIntent = new Intent(this, PianoBridgeService.class);
        if (restart) {
            stopService(serviceIntent);
        }
        // Regular started service (NOT startForegroundService): the bridge does
        // not need foreground-service privileges. It posts a persistent
        // notification via NotificationManager.notify() instead.
        startService(serviceIntent);
        Log.i(TAG, "PianoBridgeService start requested (restart=" + restart + ")");
    }
}
