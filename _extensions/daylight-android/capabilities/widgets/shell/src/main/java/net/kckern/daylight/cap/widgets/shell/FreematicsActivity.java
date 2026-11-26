package net.kckern.daylight.cap.widgets.shell;

import android.Manifest;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.companion.AssociationRequest;
import android.companion.BluetoothLeDeviceFilter;
import android.companion.CompanionDeviceManager;
import android.content.Intent;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.Locale;
import java.util.UUID;

/** Pairs from the phone and reads one encrypted characteristic while this screen is visible. */
public final class FreematicsActivity extends Activity {
    private static final UUID SERVICE = UUID.fromString("6f2da9b0-7f19-4c7b-a8a8-525a39116f05");
    private static final UUID STATUS = UUID.fromString("6f2da9b1-7f19-4c7b-a8a8-525a39116f05");
    private static final int CHOOSE = 1, CONNECT_PERMISSION = 2, ENABLE_BLUETOOTH = 3;
    private static final String ADDRESS = "device_address";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable poll = this::readStatus;
    private final Runnable retry = this::connectSaved;
    private final Runnable timeout = () -> unavailable("Device unavailable. Make sure Freematics is powered and nearby.");
    private SharedPreferences preferences;
    private CompanionDeviceManager companion;
    private BluetoothAdapter adapter;
    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic characteristic;
    private boolean visible;
    private boolean selecting, chooserLaunched, bondRequested;
    private TextView status, readings;
    private Button primary, forget;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("daylight_freematics", MODE_PRIVATE);
        companion = getSystemService(CompanionDeviceManager.class);
        BluetoothManager manager = getSystemService(BluetoothManager.class);
        adapter = manager == null ? null : manager.getAdapter();
        chooserLaunched = state != null && state.getBoolean("chooserLaunched");
        selecting = chooserLaunched;
        setTitle("Freematics");

        ScrollView scroll = new ScrollView(this);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding, padding, padding);
        scroll.addView(content);
        status = new TextView(this);
        status.setTextSize(18);
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        content.addView(status);
        readings = new TextView(this);
        readings.setTextSize(16);
        readings.setPadding(0, padding, 0, padding);
        content.addView(readings);
        primary = new Button(this);
        primary.setAllCaps(false);
        primary.setOnClickListener(view -> proceed());
        content.addView(primary);
        forget = new Button(this);
        forget.setAllCaps(false);
        forget.setText("Forget device");
        forget.setOnClickListener(view -> forgetDevice());
        content.addView(forget);
        setContentView(scroll);
        show("Pair your Freematics to view vehicle data.");
    }

    @Override protected void onStart() {
        super.onStart();
        visible = true;
        connectSaved();
    }

    @Override protected void onStop() {
        visible = false;
        main.removeCallbacks(retry);
        closeConnection();
        super.onStop();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        state.putBoolean("chooserLaunched", chooserLaunched);
    }

    private String savedAddress() {
        return preferences.getString(ADDRESS, "");
    }

    private boolean canConnect() {
        return Build.VERSION.SDK_INT < 31
                || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
    }

    private void show(String message) {
        status.setText(message);
        boolean saved = !savedAddress().isEmpty();
        primary.setText(saved ? "Retry connection" : "Pair Freematics");
        primary.setEnabled(!selecting && adapter != null);
        forget.setVisibility(saved ? View.VISIBLE : View.GONE);
    }

    // BLUETOOTH_CONNECT is checked first (canConnect, else requested) and a refusal is a
    // SecurityException, a RuntimeException the try below catches. Lint cannot see either.
    @android.annotation.SuppressLint("MissingPermission")
    private void proceed() {
        if (adapter == null) return;
        if (!canConnect()) {
            requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT}, CONNECT_PERMISSION);
            return;
        }
        try {
            if (!adapter.isEnabled()) {
                startActivityForResult(new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE), ENABLE_BLUETOOTH);
            } else if (savedAddress().isEmpty()) {
                findDevice();
            } else {
                bondRequested = false;
                connectSaved();
            }
        } catch (RuntimeException unavailable) {
            show("Bluetooth is unavailable. Check Nearby devices permission and try again.");
        }
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request != CONNECT_PERMISSION) return;
        if (canConnect()) proceed();
        else show("Allow Nearby devices to connect to Freematics.");
    }

    private void findDevice() {
        if (selecting) return;
        if (companion == null) {
            show("This phone does not provide Bluetooth companion pairing.");
            return;
        }
        selecting = true;
        show("Looking for Freematics…");
        BluetoothLeDeviceFilter filter = new BluetoothLeDeviceFilter.Builder()
                .setScanFilter(new android.bluetooth.le.ScanFilter.Builder()
                        .setServiceUuid(new ParcelUuid(SERVICE)).build())
                .build();
        AssociationRequest request = new AssociationRequest.Builder().addDeviceFilter(filter).build();
        try {
            companion.associate(request, new CompanionDeviceManager.Callback() {
                @Override public void onDeviceFound(IntentSender chooser) {
                    if (isFinishing() || isDestroyed()) return;
                    try {
                        chooserLaunched = true;
                        startIntentSenderForResult(chooser, CHOOSE, null, 0, 0, 0);
                    } catch (IntentSender.SendIntentException failure) {
                        pairingFailed();
                    }
                }

                @Override public void onFailure(CharSequence message) {
                    if (!isFinishing() && !isDestroyed()) pairingFailed();
                }
            }, main);
        } catch (RuntimeException unavailable) {
            pairingFailed();
        }
    }

    private void pairingFailed() {
        selecting = false;
        chooserLaunched = false;
        show("Freematics not found. Check that it is powered and that Location is on, then try again.");
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == ENABLE_BLUETOOTH) {
            if (result == RESULT_OK) proceed();
            else show("Turn on Bluetooth to connect to Freematics.");
            return;
        }
        if (request != CHOOSE) return;
        selecting = false;
        chooserLaunched = false;
        if (result != RESULT_OK || data == null) {
            show("Pairing canceled.");
            return;
        }
        Object selected = data.getParcelableExtra(CompanionDeviceManager.EXTRA_DEVICE);
        BluetoothDevice device = selected instanceof android.bluetooth.le.ScanResult
                ? ((android.bluetooth.le.ScanResult) selected).getDevice()
                : selected instanceof BluetoothDevice ? (BluetoothDevice) selected : null;
        String address = device == null ? "" : device.getAddress();
        if (address.isEmpty() && Build.VERSION.SDK_INT >= 33) {
            android.companion.AssociationInfo association = data.getParcelableExtra(
                    CompanionDeviceManager.EXTRA_ASSOCIATION, android.companion.AssociationInfo.class);
            if (association != null && association.getDeviceMacAddress() != null)
                address = association.getDeviceMacAddress().toString().toUpperCase(Locale.ROOT);
        }
        if (!BluetoothAdapter.checkBluetoothAddress(address)) {
            pairingFailed();
            return;
        }
        preferences.edit().putString(ADDRESS, address).apply();
        connectSaved();
    }

    // BLUETOOTH_CONNECT is checked first (canConnect, else requested) and a refusal is a
    // SecurityException, a RuntimeException the try below catches. Lint cannot see either.
    @android.annotation.SuppressLint("MissingPermission")
    private void connectSaved() {
        main.removeCallbacks(retry);
        if (!visible || selecting || savedAddress().isEmpty()) return;
        closeConnection();
        readings.setText("");
        if (!canConnect()) {
            show("Allow Nearby devices to reconnect.");
            return;
        }
        try {
            if (adapter == null || !adapter.isEnabled()) {
                show("Turn on Bluetooth to reconnect.");
                return;
            }
            show("Connecting to Freematics…");
            gatt = adapter.getRemoteDevice(savedAddress()).connectGatt(this, false, bluetooth, BluetoothDevice.TRANSPORT_LE);
            if (gatt == null) unavailable("Could not connect. Make sure Freematics is powered.");
            else main.postDelayed(timeout, 15000);
        } catch (RuntimeException failure) {
            unavailable("Could not connect. Check Bluetooth and try again.");
        }
    }

    private final BluetoothGattCallback bluetooth = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt connection, int result, int newState) {
            main.post(() -> {
                if (connection != gatt) return;
                if (result != BluetoothGatt.GATT_SUCCESS || newState != BluetoothProfile.STATE_CONNECTED) {
                    unavailable("Device unavailable. Waiting for Freematics to reconnect.");
                } else {
                    try {
                        if (!connection.discoverServices()) unavailable("Could not discover the Freematics service.");
                    } catch (SecurityException denied) {
                        unavailable("Allow Nearby devices to reconnect.");
                    }
                }
            });
        }

        @Override public void onServicesDiscovered(BluetoothGatt connection, int result) {
            main.post(() -> {
                if (connection != gatt) return;
                BluetoothGattService service = result == BluetoothGatt.GATT_SUCCESS ? connection.getService(SERVICE) : null;
                characteristic = service == null ? null : service.getCharacteristic(STATUS);
                if (characteristic == null) unavailable("Freematics is missing the Daylight Bluetooth firmware service.");
                else readStatus();
            });
        }

        @Override public void onCharacteristicRead(BluetoothGatt connection, BluetoothGattCharacteristic item, int result) {
            dispatchReading(connection, item, item.getValue(), result);
        }

        @Override public void onCharacteristicRead(BluetoothGatt connection, BluetoothGattCharacteristic item,
                                                   byte[] value, int result) {
            dispatchReading(connection, item, value, result);
        }
    };

    private void readStatus() {
        if (gatt == null || characteristic == null) return;
        try {
            if (gatt.readCharacteristic(characteristic)) {
                main.removeCallbacks(timeout);
                main.postDelayed(timeout, readings.getText().length() == 0 ? 20000 : 4500);
                return;
            }
        } catch (SecurityException denied) {
            unavailable("Allow Nearby devices to reconnect.");
            return;
        }
        unavailable("Could not read Freematics data. Retrying…");
    }

    private void dispatchReading(BluetoothGatt connection, BluetoothGattCharacteristic item, byte[] value, int result) {
        byte[] copy = value == null ? null : value.clone();
        main.post(() -> {
            if (connection != gatt || item != characteristic) return;
            main.removeCallbacks(timeout);
            if (result == BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION
                    || result == BluetoothGatt.GATT_INSUFFICIENT_ENCRYPTION) {
                show("Complete Android’s Bluetooth pairing prompt.");
                try {
                    BluetoothDevice device = connection.getDevice();
                    if (device.getBondState() == BluetoothDevice.BOND_NONE) {
                        if (bondRequested || !device.createBond()) {
                            closeConnection();
                            readings.setText("");
                            show("Bluetooth pairing wasn’t completed. Tap Retry connection to try again.");
                            return;
                        }
                        bondRequested = true;
                    }
                } catch (SecurityException denied) {
                    unavailable("Allow Nearby devices to pair.");
                    return;
                }
                main.postDelayed(poll, 2200);
                return;
            }
            FreematicsReading reading = result == BluetoothGatt.GATT_SUCCESS ? FreematicsReading.decode(copy) : null;
            if (reading == null) {
                unavailable("No compatible response from Freematics. Check the firmware version.");
                return;
            }
            boolean liveVehicle = reading.speed != null || reading.rpm != null || reading.coolant != null;
            show(liveVehicle ? "Connected" : "Connected · no live vehicle data");
            readings.setText("Battery  " + (reading.millivolts == 0 ? "Unavailable"
                    : String.format(Locale.getDefault(), "%.2f V", reading.millivolts / 1000f))
                    + "\nCoolant  " + value(reading.coolant, " °C")
                    + "\nEngine  " + value(reading.rpm, " rpm")
                    + "\nSpeed  " + value(reading.speed, " km/h")
                    + "\nUpdated  " + java.text.DateFormat.getTimeInstance().format(new java.util.Date()));
            main.postDelayed(poll, 1000);
        });
    }

    private static String value(Integer value, String unit) {
        return value == null ? "Unavailable" : value + unit;
    }

    private void unavailable(String message) {
        closeConnection();
        readings.setText("");
        show(message);
        main.removeCallbacks(retry);
        if (visible && canConnect()) main.postDelayed(retry, 8000);
    }

    private void closeConnection() {
        main.removeCallbacks(poll);
        main.removeCallbacks(timeout);
        BluetoothGatt old = gatt;
        gatt = null;
        characteristic = null;
        if (old != null) {
            try { old.close(); }
            catch (SecurityException ignored) { }
        }
    }

    private void forgetDevice() {
        String address = savedAddress();
        main.removeCallbacks(retry);
        closeConnection();
        if (companion != null && !address.isEmpty()) {
            try { companion.disassociate(address); }
            catch (RuntimeException ignored) { }
        }
        preferences.edit().remove(ADDRESS).apply();
        bondRequested = false;
        readings.setText("");
        show("Device forgotten. Pair Freematics to connect again.");
    }
}
