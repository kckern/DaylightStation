package net.kckern.pianobridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
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
    private static final int REQ_LOCATION = 1;

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

        // BLE scanning on Android 10 requires ACCESS_FINE_LOCATION granted at
        // runtime. Request it before the service tries to scan; the grant
        // persists, so this is a one-time setup tap. Then start the service.
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            status.setText("Piano Bridge — grant Location to connect the BLE piano");
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION}, REQ_LOCATION);
        } else {
            startBridgeService(false);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Log.i(TAG, "Location permission granted=" + granted);
            // Start regardless; the connector reports NO_LOCATION over /status if denied.
            startBridgeService(false);
        }
    }

    private void startBridgeService(boolean restart) {
        Intent serviceIntent = new Intent(this, PianoBridgeService.class);
        if (restart) {
            stopService(serviceIntent);
        }
        // Foreground service so it's legal to start even when Fully Kiosk has
        // already pulled us to the background, and so the kiosk won't kill it.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        Log.i(TAG, "PianoBridgeService start requested (restart=" + restart + ")");
    }
}
