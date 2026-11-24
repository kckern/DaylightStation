package net.kckern.daylight.shell;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.PermissionInfo;
import android.os.Bundle;
import android.os.PowerManager;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * Starts the service and asks for what only an activity may ask for: the
 * battery-optimization exemption and any runtime permission the device's
 * capabilities declared. Then leaves. Phase 3's kiosk activity lives elsewhere.
 */
public class MainActivity extends Activity {
    private static final String TAG = "Daylight";
    private static final int REQUEST = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent service = new Intent(this, ShellService.class);
        if (BuildConfig.PERSISTENT_SERVICE) startForegroundService(service); else startService(service);
        requestBatteryExemptionIfNeeded();
        String[] missing = missingRuntimePermissions();
        if (missing.length == 0) { finish(); return; }
        ShellLog.install(this);
        ShellLog.note("PERMISSIONS", "requesting " + missing.length + " runtime permission(s)");
        requestPermissions(missing, REQUEST);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        int granted = 0;
        for (int r : results) if (r == PackageManager.PERMISSION_GRANTED) granted++;
        ShellLog.note("PERMISSIONS", granted + " of " + results.length + " granted");
        finish();
    }

    /**
     * Ask once per launch, and only while not exempt. Samsung's "sleeping apps"
     * force-stops anything outside the exemption list, and a force-stopped app gets
     * no sticky restart, no alarms and no boot broadcast.
     */
    private void requestBatteryExemptionIfNeeded() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
            ShellLog.install(this);
            ShellLog.note("BATTERY", "not exempt from battery optimization, requesting");
            startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(android.net.Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            Log.w(TAG, "battery exemption request failed: " + e.getMessage());
        }
    }

    /** Declared, dangerous, and not yet granted. The manifest is the single list. */
    private String[] missingRuntimePermissions() {
        List<String> out = new ArrayList<>();
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), PackageManager.GET_PERMISSIONS);
            if (info.requestedPermissions != null) {
                for (String p : info.requestedPermissions) {
                    try {
                        PermissionInfo pi = getPackageManager().getPermissionInfo(p, 0);
                        boolean dangerous = (pi.protectionLevel & PermissionInfo.PROTECTION_MASK_BASE) == PermissionInfo.PROTECTION_DANGEROUS;
                        if (dangerous && checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) out.add(p);
                    } catch (PackageManager.NameNotFoundException notOnThisAndroid) { }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "could not list permissions: " + e.getMessage());
        }
        return out.toArray(new String[0]);
    }
}
