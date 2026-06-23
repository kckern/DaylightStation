package net.kckern.pianobridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import java.io.File;
import java.io.IOException;

/**
 * PianoBridgeService — the core. Hosts the native synth (PianoEngine), reads the
 * BLE-MIDI piano via MidiManager, and runs the WebSocket control server.
 *
 * Lifecycle note (mirrors audio-bridge's hard-won lesson, DESIGN.md): this is a
 * REGULAR started service. We do NOT call startForeground() — on Android 11 a
 * foreground service started from a background context loses while-in-use
 * permissions. Instead we post a persistent notification via
 * NotificationManager.notify() and rely on the device being always plugged in.
 */
public class PianoBridgeService extends Service {

    private static final String TAG = "PianoBridge";
    private static final String CHANNEL_ID = "piano_bridge_channel";
    private static final int NOTIFICATION_ID = 1;

    /** Where instrument assets (SFZ samples, DX7 .syx banks) are pushed via adb. */
    public static final String INSTRUMENTS_DIR = "/sdcard/piano-instruments";

    /**
     * BLE-MIDI input device name substring used to pick the piano. Override-able
     * via the "midi_name" string extra on the start Intent. Empty = first input.
     */
    private String midiNameFilter = "";

    private PianoEngine engine;
    private ControlServer controlServer;

    private MidiManager midiManager;
    private MidiDevice openMidiDevice;
    private MidiOutputPort openMidiPort;
    private MidiReceiver midiReceiver;

    private volatile boolean engineRunning = false;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.i(TAG, "Service created");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.i(TAG, "Service starting");

        if (intent != null && intent.hasExtra("midi_name")) {
            midiNameFilter = intent.getStringExtra("midi_name");
            Log.i(TAG, "MIDI name filter set to '" + midiNameFilter + "'");
        }

        // Persistent notification WITHOUT startForeground (see class javadoc).
        postNotification();

        if (engine == null) {
            engine = new PianoEngine();
            if (!engine.init()) {
                Log.e(TAG, "PianoEngine.init failed");
            }
        }

        if (controlServer == null) {
            controlServer = new ControlServer(this);
            try {
                // 0 timeout = no socket read timeout; daemon thread.
                controlServer.start(0, true);
                Log.i(TAG, "ControlServer started on port " + ControlServer.PORT);
            } catch (IOException e) {
                Log.e(TAG, "ControlServer failed to start", e);
            }
        }

        openMidi();

        // Regular service: do not auto-restart with a sticky intent; the kiosk
        // (and BootReceiver / MainActivity) re-launch us explicitly.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service destroying");
        closeMidi();
        if (controlServer != null) {
            controlServer.stop();
            controlServer = null;
        }
        if (engine != null) {
            engine.stop();
            engine.release();
            engine = null;
        }
        engineRunning = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- accessors used by ControlServer ---

    public PianoEngine getEngine() { return engine; }

    public boolean isEngineRunning() { return engineRunning; }

    public File getInstrumentsDir() { return new File(INSTRUMENTS_DIR); }

    public synchronized void engineStart() {
        if (engine == null) { Log.w(TAG, "engineStart: no engine"); return; }
        if (engineRunning) return;
        engineRunning = engine.start();
        Log.i(TAG, "engineStart running=" + engineRunning);
    }

    public synchronized void engineStop() {
        if (engine == null) return;
        engine.stop();
        engineRunning = false;
        Log.i(TAG, "engineStop");
    }

    // --- notification ---

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Piano Bridge", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Piano bridge service notification");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void postNotification() {
        Notification notification = new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("Piano Bridge")
                .setContentText("Synth host running — control via kiosk")
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setOngoing(true)
                .build();
        // notify(), NOT startForeground() — regular started service.
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
    }

    // --- MIDI input via MidiManager ---

    private void openMidi() {
        midiManager = (MidiManager) getSystemService(Context.MIDI_SERVICE);
        if (midiManager == null) {
            Log.e(TAG, "MidiManager unavailable on this device");
            return;
        }

        MidiDeviceInfo[] infos = midiManager.getDevices();
        Log.i(TAG, "MidiManager reports " + infos.length + " device(s)");

        MidiDeviceInfo chosen = null;
        for (MidiDeviceInfo info : infos) {
            // Must have at least one output port (device -> us).
            if (info.getOutputPortCount() <= 0) continue;
            String name = info.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "");
            Log.i(TAG, "  MIDI device: '" + name + "' outputs=" + info.getOutputPortCount());
            if (midiNameFilter == null || midiNameFilter.isEmpty()
                    || (name != null && name.toLowerCase().contains(midiNameFilter.toLowerCase()))) {
                chosen = info;
                if (midiNameFilter != null && !midiNameFilter.isEmpty()) break; // exact-ish match wins
            }
        }

        if (chosen == null) {
            Log.w(TAG, "No matching MIDI input device found (filter='" + midiNameFilter
                    + "'). Relay mode (WS note.on/off) still available.");
            return;
        }

        final MidiDeviceInfo target = chosen;
        midiManager.openDevice(target, new MidiManager.OnDeviceOpenedListener() {
            @Override
            public void onDeviceOpened(MidiDevice device) {
                if (device == null) {
                    Log.e(TAG, "Failed to open MIDI device");
                    return;
                }
                openMidiDevice = device;
                openMidiPort = device.openOutputPort(0);
                if (openMidiPort == null) {
                    Log.e(TAG, "Failed to open MIDI output port 0");
                    return;
                }
                midiReceiver = new PianoMidiReceiver();
                openMidiPort.connect(midiReceiver);
                String name = target.getProperties().getString(MidiDeviceInfo.PROPERTY_NAME, "");
                Log.i(TAG, "MIDI input connected: '" + name + "'");
            }
        }, new Handler(Looper.getMainLooper()));
    }

    private void closeMidi() {
        try {
            if (openMidiPort != null) {
                if (midiReceiver != null) openMidiPort.disconnect(midiReceiver);
                openMidiPort.close();
            }
        } catch (IOException e) {
            Log.w(TAG, "Error closing MIDI port", e);
        } finally {
            openMidiPort = null;
            midiReceiver = null;
        }
        try {
            if (openMidiDevice != null) openMidiDevice.close();
        } catch (IOException e) {
            Log.w(TAG, "Error closing MIDI device", e);
        } finally {
            openMidiDevice = null;
        }
    }

    /**
     * Parses raw MIDI bytes into note-on/off + CC, forwards to the native engine
     * and fans the notes out to connected WS clients (browser visualizers).
     * MIDI running-status is not handled here for brevity — most BLE-MIDI
     * keyboards send full status bytes per message.
     */
    private class PianoMidiReceiver extends MidiReceiver {
        @Override
        public void onSend(byte[] data, int offset, int count, long timestamp) {
            int i = offset;
            int end = offset + count;
            while (i < end) {
                int status = data[i] & 0xFF;
                if (status < 0x80) { i++; continue; } // skip stray data bytes
                int type = status & 0xF0;

                if (type == 0x90 && i + 2 < end) { // note on
                    int note = data[i + 1] & 0x7F;
                    int vel = data[i + 2] & 0x7F;
                    if (vel == 0) {
                        handleNoteOff(note);
                    } else {
                        if (engine != null) engine.noteOn(note, vel);
                        if (controlServer != null) controlServer.fanOutNoteOn(note, vel);
                    }
                    i += 3;
                } else if (type == 0x80 && i + 2 < end) { // note off
                    int note = data[i + 1] & 0x7F;
                    handleNoteOff(note);
                    i += 3;
                } else if (type == 0xB0 && i + 2 < end) { // control change
                    int cc = data[i + 1] & 0x7F;
                    int val = data[i + 2] & 0x7F;
                    if (engine != null) engine.setParam("cc." + cc, val / 127f);
                    i += 3;
                } else {
                    // Unhandled status (pitch bend, aftertouch, sysex, etc.) — skip 1.
                    i++;
                }
            }
        }

        private void handleNoteOff(int note) {
            if (engine != null) engine.noteOff(note);
            if (controlServer != null) controlServer.fanOutNoteOff(note);
        }
    }
}
