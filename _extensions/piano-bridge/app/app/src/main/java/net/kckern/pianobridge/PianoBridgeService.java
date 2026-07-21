package net.kckern.pianobridge;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.midi.MidiDevice;
import android.media.midi.MidiDeviceInfo;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

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

    /** Subdir (under the app's external files dir) where instrument assets live. */
    public static final String INSTRUMENTS_SUBDIR = "piano-instruments";

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

    // MIDI-IN health (the note-read path: device output port → PianoMidiReceiver →
    // WS fan-out). Surfaced in /diagnostics so a dead input path is VISIBLE instead
    // of masquerading as a healthy BLE link — this bug was otherwise only findable in
    // a crash snapshot. These three are already maintained by the retry logic below;
    // exposing them is free. See connectPort / attemptOpenPort.
    private volatile boolean midiPortOpen = false;
    private volatile String midiPortLastError = null;
    private volatile int midiPortAttempts = 0;
    // Retries openOutputPort off the callback thread (the Android-10 BLE-MIDI
    // port-registration race — see attemptOpenPort). Lazily created; shut down in onDestroy.
    private ScheduledExecutorService midiPortExec;
    // openOutputPort can NPE right after the device opens because the MidiDeviceServer
    // hasn't registered the port yet. Retry a few times ~700ms apart (the port appears
    // within a second or two); if it still fails, force a full device re-open.
    private static final int MIDI_PORT_MAX_ATTEMPTS = 8;
    private static final long MIDI_PORT_RETRY_MS = 700L;

    private DeviceConfig config;
    private BleMidiConnector bleConnector;
    private A2dpConnector a2dpConnector;
    private ScreenWaker screenWaker;
    private TouchPulser touchPulser;
    private KioskWatchdog kioskWatchdog;
    private KioskSettingsGuard kioskSettingsGuard;

    /**
     * Wall-clock ms of the last POST /update. The kiosk-settings guard stands down for
     * a window after this: installing a new APK REQUIRES kiosk mode to be OFF (FKB's
     * kiosk mode auto-dismisses Android's install dialog → INSTALL_FAILED_ABORTED), so
     * re-asserting it mid-install would break the very deploy that ships the guard.
     * 0 = no install has been requested this process lifetime.
     */
    private volatile long lastUpdateRequestAtMs = 0;

    // Fail-closed audio guard: keeps the built-in speaker silent whenever the piano's
    // A2DP sink isn't the active route. Reconciled off the main thread (binder calls).
    // volatile: nulled on the main/binder thread (teardown) but read on audioGuardHandler.
    private volatile AudioRouteGuard audioGuard;
    private HandlerThread audioGuardThread;
    private Handler audioGuardHandler;
    private AudioDeviceCallback audioDeviceCallback;
    private BroadcastReceiver volumeReceiver;

    private volatile boolean engineRunning = false;

    /** The kiosk's INTENT (WS engine.start/engine.stop). Distinct from whether the
     *  native stream is actually open, which an A2DP drop can change under us. */
    private volatile boolean engineDesired = false;

    public boolean isEngineDesired() { return engineDesired; }

    @Override
    public void onCreate() {
        super.onCreate();
        // FIRST: arm durable crash/lifecycle logging so we capture WHY the bridge
        // dies (Diag is in-memory and dies with the process). Detects an unclean
        // previous death (the 2026-07-03 outage was unrecoverable after the fact).
        CrashLog.install(this);
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

        startBleMidi();

        // Out-of-process WebView watchdog: created once (survives config reloads via
        // updateConfig so it never loses beat state). startBleMidi() has just loaded
        // `config`, so it's non-null here.
        if (kioskWatchdog == null) {
            kioskWatchdog = new KioskWatchdog(this, config);
            kioskWatchdog.start();
        } else {
            kioskWatchdog.updateConfig(config);
        }

        // FKB kiosk-settings drift guard — a SEPARATE concern from the page-health
        // watchdog above, on its own slow (60s) timer. Same create-once/update-config
        // lifecycle so a config reload never resets its repair counters.
        if (kioskSettingsGuard == null) {
            kioskSettingsGuard = new KioskSettingsGuard(this, config);
            kioskSettingsGuard.start();
        } else {
            kioskSettingsGuard.updateConfig(config);
        }

        // START_STICKY: if the OS reclaims the process under memory pressure, revive
        // the service automatically (onStartCommand re-runs with a null intent, which
        // the midi_name guard above tolerates). Reboots are covered by BootReceiver and
        // a manual ADB-free restart by FKB `startApplication` (fkb.cli launch) — this
        // adds a third net so a dark, un-wakeable tablet can't result from a mid-run kill.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "Service destroying");
        if (kioskWatchdog != null) { kioskWatchdog.stop(); kioskWatchdog = null; }
        if (kioskSettingsGuard != null) { kioskSettingsGuard.stop(); kioskSettingsGuard = null; }
        CrashLog.markCleanShutdown(); // so the next start isn't misread as a crash
        if (bleConnector != null) { bleConnector.stop(); bleConnector = null; }
        if (a2dpConnector != null) { a2dpConnector.stop(); a2dpConnector = null; }
        teardownAudioGuard();
        if (audioGuardThread != null) { audioGuardThread.quitSafely(); audioGuardThread = null; audioGuardHandler = null; }
        if (screenWaker != null) { screenWaker.shutdown(); screenWaker = null; }
        touchPulser = null;
        if (midiPortExec != null) { midiPortExec.shutdownNow(); midiPortExec = null; }
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
        engineDesired = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // --- accessors used by ControlServer ---

    public PianoEngine getEngine() { return engine; }

    /** Native stream state is the truth; the engineRunning flag goes stale when an
     *  Oboe error closes the stream out from under us. */
    public boolean isEngineRunning() { return engine != null && engine.isStreamRunning(); }

    /**
     * App-specific external files dir (no storage permission needed, always
     * readable by native code): /sdcard/Android/data/net.kckern.pianobridge/files/piano-instruments.
     * Avoids the Android-10 scoped-storage / restricted-READ_EXTERNAL_STORAGE trap
     * that blocks native fopen() on arbitrary /sdcard paths.
     */
    public File getInstrumentsDir() { return new File(getExternalFilesDir(null), INSTRUMENTS_SUBDIR); }

    public synchronized void engineStart() {
        engineDesired = true;
        if (engine == null) { Log.w(TAG, "engineStart: no engine"); return; }
        if (engine.isStreamRunning()) return;
        engineRunning = engine.start();
        Log.i(TAG, "engineStart running=" + engineRunning);
    }

    public synchronized void engineStop() {
        engineDesired = false;
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
        // Foreground service: legal to (re)start from a background/kiosk context and
        // not killed when Fully Kiosk reclaims the foreground. Unlike the sibling
        // audio-bridge, this app has NO mic, so the Android-11 foreground-service mic
        // restriction that forced audio-bridge to avoid startForeground() does not apply.
        startForeground(NOTIFICATION_ID, notification);
    }

    // --- BLE-MIDI input via BleMidiConnector ---

    /**
     * Start the BLE-MIDI connector: it scans for the configured piano BY MAC,
     * opens it via MidiManager.openBluetoothDevice() (which also registers it so
     * the browser's Web MIDI sees it), connects its output port to our receiver,
     * and auto-reconnects on drop. Replaces the old getDevices() approach, which
     * could only read a device some OTHER app had already paired.
     */
    private void startBleMidi() {
        if (config == null) config = DeviceConfig.load(this);
        // (Re)build the FKB screen-waker from the current config (fkbPassword etc.
        // may have changed via a pbctl /config edit → reloadConfigAndReconnect).
        if (screenWaker != null) screenWaker.shutdown();
        screenWaker = new ScreenWaker(config);

        // (Re)build the synthetic-touch un-throttler and SELF-ENABLE its
        // AccessibilityService over the LAN (WRITE_SECURE_SETTINGS) — no USB, no
        // manual toggle. The system binds PianoTouchService shortly after.
        touchPulser = new TouchPulser(config);
        if (config.tapWakeEnabled()) {
            String comp = new ComponentName(this, PianoTouchService.class).flattenToString();
            org.json.JSONObject r = SettingsControl.enableAccessibilityService(this, comp);
            Log.i(TAG, "enableAccessibilityService " + comp + " -> " + r);
        }

        midiManager = (MidiManager) getSystemService(Context.MIDI_SERVICE);
        if (midiManager == null) {
            Log.e(TAG, "MidiManager unavailable on this device");
            return;
        }
        if (bleConnector == null) {
            bleConnector = new BleMidiConnector(this, config, new BleMidiConnector.Listener() {
                @Override public void onMidiDeviceOpened(MidiDevice device, String name, String mac) {
                    connectPort(device);
                }
                @Override public void onMidiDeviceClosed() {
                    closeMidi();
                }
            });
            bleConnector.start();
        } else {
            bleConnector.connectNow();
        }

        // Keep the A2DP speaker (the piano's audio sink) connected so the synth is
        // audible. Independent of MIDI — runs its own reconnect watchdog.
        if (a2dpConnector == null) {
            a2dpConnector = new A2dpConnector(this, config);
            a2dpConnector.start();
        } else {
            a2dpConnector.connectNow();
        }

        // Fail-closed audio guard. `engine` was created in onStartCommand before this
        // method runs (and is never nulled by reloadConfigAndReconnect), so it is
        // non-null here — the spec's construction point is correct. Built once; on a
        // config reload teardownAudioGuard() clears it so it never holds a stale
        // A2dpConnector (see reloadConfigAndReconnect).
        if (audioGuard == null) {
            audioGuard = new AudioRouteGuard(
                    new AndroidAudioOps(this, a2dpConnector, engine, this::isEngineDesired));
            registerAudioRouteCallbacks(); // creates audioGuardThread/Handler
            // Hop off the BT broadcast/sweep thread: reconcile() now opens the audio HAL
            // via engine.start(), which must not stall A2DP reconnect handling.
            a2dpConnector.setOnStateChanged(() -> audioGuardHandler.post(this::safeReconcile));
        }
        // Fail-closed: assert desired state immediately. reconcile() does binder calls,
        // so run it OFF the main thread (onStartCommand runs on main). See Rule 3.
        if (audioGuardHandler != null) {
            audioGuardHandler.post(this::safeReconcile);
        }
    }

    /** Reconcile on the guard thread, null-safe and crash-safe: an uncaught throw on a
     *  Handler thread would kill the process (dark tablet in a sealed box). */
    private void safeReconcile() {
        AudioRouteGuard g = audioGuard;
        if (g == null) return;
        try { g.reconcile(); } catch (Throwable t) { Log.w(TAG, "reconcile threw", t); }
    }

    /**
     * Register the two edge triggers that supplement A2dpConnector's state hook:
     *  1) AudioDeviceCallback — output device added/removed (wired plug/unplug, A2DP up/down).
     *  2) VOLUME_CHANGED_ACTION — stomps a stray volume-up back to 0.
     * Both fire reconcile() on a dedicated background Handler; reconcile() must never
     * run on the main thread (it does binder calls). References are kept for teardown.
     */
    private void registerAudioRouteCallbacks() {
        if (audioGuardThread == null) {
            audioGuardThread = new HandlerThread("PianoBridge-audioguard");
            audioGuardThread.start();
            audioGuardHandler = new Handler(audioGuardThread.getLooper());
        }
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (am != null && audioDeviceCallback == null) {
            audioDeviceCallback = new AudioDeviceCallback() {
                @Override public void onAudioDevicesAdded(AudioDeviceInfo[] added) {
                    safeReconcile();
                }
                @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
                    safeReconcile();
                }
            };
            am.registerAudioDeviceCallback(audioDeviceCallback, audioGuardHandler);
        }
        if (volumeReceiver == null) {
            volumeReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context c, Intent i) {
                    safeReconcile();
                }
            };
            registerReceiver(volumeReceiver,
                    new IntentFilter("android.media.VOLUME_CHANGED_ACTION"), null, audioGuardHandler);
        }
    }

    /** Unregister the audio-route callbacks and drop the guard (onDestroy / config reload). */
    private void teardownAudioGuard() {
        if (audioDeviceCallback != null) {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                try { am.unregisterAudioDeviceCallback(audioDeviceCallback); } catch (Exception ignored) { }
            }
            audioDeviceCallback = null;
        }
        if (volumeReceiver != null) {
            try { unregisterReceiver(volumeReceiver); } catch (Exception ignored) { }
            volumeReceiver = null;
        }
        audioGuard = null;
    }

    public AudioRouteGuard getAudioGuard() { return audioGuard; }

    public A2dpConnector getA2dpConnector() { return a2dpConnector; }

    public KioskWatchdog getKioskWatchdog() { return kioskWatchdog; }

    public KioskSettingsGuard getKioskSettingsGuard() { return kioskSettingsGuard; }

    /**
     * Stamp an install request (POST /update) so the kiosk-settings guard stands down.
     *
     * <p>The hold DEADLINE is both set on the guard (immediate effect) and PERSISTED to
     * config, because the install this guards against stops the service — deploy step 7
     * relaunches it, repeatedly if need be. An in-memory-only hold reset to 0 on each of
     * those restarts and evaporated (found deploying v22, 2026-07-21), so a retried or
     * second install ran with no suppression at all. Persisting the deadline (not the
     * request time) also means later shortening {@code watchdogKioskSettingsInstallHoldMs}
     * can't cut short a hold that is already running.
     *
     * <p>Deliberately does NOT call {@link #reloadConfigAndReconnect()}: that tears down
     * BLE-MIDI and A2DP, and doing that during an install is exactly wrong. The merging
     * {@code writeOverride} leaves every sibling key intact.
     */
    public void markUpdateRequested() {
        long now = System.currentTimeMillis();
        lastUpdateRequestAtMs = now;
        long holdMs = config != null ? config.watchdogKioskSettingsInstallHoldMs() : 900000L;
        long until = now + holdMs;
        if (kioskSettingsGuard != null) kioskSettingsGuard.setInstallHoldUntil(until);
        try {
            DeviceConfig.writeOverride(this, "kioskSettingsInstallHoldUntilEpochMs: " + until + "\n");
        } catch (IOException e) {
            // In-memory hold still applies for this process; only restart-survival is lost.
            Log.w(TAG, "could not persist install hold deadline", e);
            CrashLog.note("KIOSKSET", "WARN: install-hold deadline not persisted (" + e.getMessage()
                    + ") — hold will not survive the install's service restart");
        }
        CrashLog.note("KIOSKSET", "install requested — kiosk-settings guard holding off until " + until);
    }

    public long lastUpdateRequestAtMs() { return lastUpdateRequestAtMs; }

    /**
     * Wire a freshly opened MidiDevice's output port 0 to the MIDI receiver — the
     * note-IN path. Delegates to the retrying opener because on the SM-T590 (Android
     * 10) BLE-MIDI stack, openOutputPort() called straight from onMidiDeviceOpened
     * frequently throws inside the framework (NPE: MidiDeviceInfo.isPrivate() on a
     * null ref) — the MidiDeviceServer hasn't registered the device's port info yet.
     * Before 2026-07-15 that throw was uncaught: it killed the callback thread, left
     * the BLE link marked CONNECTED with NO read port, and never retried → MIDI OUT
     * kept working (that's the kiosk's own Web MIDI) while MIDI IN was silently dead.
     */
    private synchronized void connectPort(MidiDevice device) {
        closeMidi(); // tear down any previous port first
        openMidiDevice = device;
        midiPortAttempts = 0;
        attemptOpenPort(device, 1);
    }

    /**
     * One attempt to open output port 0 and attach the receiver, guarded so a
     * framework throw can never kill the thread. On failure it reschedules itself
     * (~700ms backoff) up to MIDI_PORT_MAX_ATTEMPTS — the port registers within a
     * second or two. If every attempt fails, force a full device re-open via the
     * connector (a fresh openBluetoothDevice resets the race), so the note-IN path
     * can never wedge permanently. Guarded by identity: a newer connect (or a
     * closeMidi) that supersedes `device` abandons this retry chain.
     */
    private synchronized void attemptOpenPort(MidiDevice device, int attempt) {
        if (device != openMidiDevice) return; // superseded by a newer connect/close
        midiPortAttempts = attempt;
        MidiOutputPort port = null;
        try {
            port = device.openOutputPort(0);
        } catch (Throwable t) {
            midiPortLastError = t.getClass().getSimpleName() + ": " + t.getMessage();
            Log.w(TAG, "openOutputPort attempt " + attempt + " threw", t);
        }
        if (port != null) {
            openMidiPort = port;
            midiReceiver = new PianoMidiReceiver();
            openMidiPort.connect(midiReceiver);
            midiPortOpen = true;
            midiPortLastError = null;
            Log.i(TAG, "MIDI output port connected (attempt " + attempt + ")");
            CrashLog.note("MIDI", "note-IN port connected (attempt " + attempt + ")");
            return;
        }
        if (attempt >= MIDI_PORT_MAX_ATTEMPTS) {
            Log.e(TAG, "MIDI output port failed after " + attempt + " attempts — forcing device re-open");
            CrashLog.note("MIDI", "note-IN port FAILED after " + attempt
                    + " attempts (" + midiPortLastError + ") — forcing reconnect");
            if (bleConnector != null) bleConnector.connectNow(); // full reopen resets the port race
            return;
        }
        scheduleOpenPortRetry(device, attempt + 1);
    }

    private void scheduleOpenPortRetry(final MidiDevice device, final int nextAttempt) {
        if (midiPortExec == null || midiPortExec.isShutdown()) {
            midiPortExec = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "PianoBridge-midiport"); t.setDaemon(true); return t;
            });
        }
        midiPortExec.schedule(() -> {
            try { attemptOpenPort(device, nextAttempt); }
            catch (Throwable t) { Log.e(TAG, "port-open retry crashed", t); }
        }, MIDI_PORT_RETRY_MS, TimeUnit.MILLISECONDS);
    }

    /** MIDI-IN health for /diagnostics: is the read port open, and are notes flowing? */
    public JSONObject midiInStatus() {
        JSONObject o = new JSONObject();
        try {
            o.put("portOpen", midiPortOpen);
            o.put("attempts", midiPortAttempts);
            o.put("lastError", midiPortLastError == null ? JSONObject.NULL : midiPortLastError);
        } catch (Exception ignored) { }
        return o;
    }

    // --- accessors / control used by ControlServer ---

    public BleMidiConnector getBleConnector() { return bleConnector; }

    public DeviceConfig getConfig() { return config; }

    /** Re-read the device config (after a pbctl /config edit) and reconnect. */
    public synchronized void reloadConfigAndReconnect() {
        config = DeviceConfig.load(this);
        if (bleConnector != null) { bleConnector.stop(); bleConnector = null; }
        if (a2dpConnector != null) { a2dpConnector.stop(); a2dpConnector = null; }
        // The guard's Ops closes over the now-dead a2dpConnector, so drop it and let
        // startBleMidi() rebuild it against the fresh connector. teardownAudioGuard()
        // keeps the audioGuardThread alive; registerAudioRouteCallbacks reuses it.
        teardownAudioGuard();
        closeMidi();
        startBleMidi();
        // Refresh watchdog thresholds/policy in place (keeps its beat state).
        if (kioskWatchdog != null) kioskWatchdog.updateConfig(config);
        // Same for the kiosk-settings guard, so `pbctl config set` takes effect
        // without a restart and its repair counters survive the reload.
        if (kioskSettingsGuard != null) kioskSettingsGuard.updateConfig(config);
    }

    private synchronized void closeMidi() {
        midiPortOpen = false;
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
                        // Wake the tablet's FKB backlight if it's dark (debounced).
                        if (screenWaker != null) screenWaker.poke();
                        // Keep the WebView frame clock un-throttled while playing.
                        if (touchPulser != null) touchPulser.poke();
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
