package net.kckern.pianobridge;

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
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import net.kckern.pianobridge.api.ShellServices;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * BridgeCore — the core, living in the hot-swappable payload. Drives the native synth
 * (PianoEngine, shell-owned), reads the BLE-MIDI piano via MidiManager, and runs the
 * WebSocket control server. This is the former body of PianoBridgeService turned into
 * a plain class: it HOLDS a Context (from {@link ShellServices#context()}) instead of
 * being one. The shell owns the Service, its notification and the engine's lifecycle;
 * {@link net.kckern.pianobridge.payload.Main} calls {@link #start()} / {@link #stop()}.
 */
public class BridgeCore {

    private static final String TAG = "PianoBridge";

    private final ShellServices shell;
    private final Context ctx;

    public BridgeCore(ShellServices shell) {
        this.shell = shell;
        this.ctx = (Context) shell.context();
    }

    public Context getContext() { return ctx; }

    public ShellServices getShell() { return shell; }

    /** Subdir (under the app's external files dir) where instrument assets live. */
    public static final String INSTRUMENTS_SUBDIR = "piano-instruments";

    /** BLE-MIDI input device name substring used to pick the piano. Empty = first input. */
    private String midiNameFilter = "";

    private PianoEngine engine;
    private ControlServer controlServer;

    private MidiManager midiManager;
    private MidiDevice openMidiDevice;
    private MidiOutputPort openMidiPort;
    private MidiReceiver midiReceiver;

    // MIDI-OUT (the WRITE path: us → JamCorder → piano). In Android MIDI a device's
    // INPUT port is the one you write INTO, so this is openInputPort(0) — the mirror
    // of openMidiPort above. Added 2026-08-22.
    //
    // Why it exists: until now the APK could only READ. That left the browser as the
    // sole writer, which (a) made it a second claimant on the one BLE radio, the
    // contention behind the 2026-08-22 one-way outage, and (b) capped what could ever
    // be sent — the FKB WebView is permanently denied Web MIDI SysEx
    // (NotAllowedError, re-verified on Chrome 151), so reverb/chorus could not be
    // expressed from the browser at all, no matter how healthy the link.
    private MidiInputPort openMidiInPort;
    private volatile boolean midiWriteOpen = false;
    private volatile String midiWriteLastError = null;

    // MIDI-IN health (the note-read path: device output port → PianoMidiReceiver →
    // WS fan-out). Surfaced in /diagnostics so a dead input path is VISIBLE instead
    // of masquerading as a healthy BLE link — this bug was otherwise only findable in
    // a crash snapshot. These three are already maintained by the retry logic below;
    // exposing them is free. See connectPort / attemptOpenPort.
    private volatile boolean midiPortOpen = false;
    private volatile String midiPortLastError = null;
    private volatile int midiPortAttempts = 0;
    // Retries openOutputPort off the callback thread (the Android-10 BLE-MIDI
    // port-registration race — see attemptOpenPort). Lazily created; shut down in stop().
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
    private Heartbeat heartbeat;
    private Loopback loopback;
    // Raw MIDI-IN tap: the last chunks the read port delivered, exactly as received.
    // The only way to see what the parser is actually being handed — added when a
    // piano echo provably reached the tablet (JamCorder bleOut +1) but never
    // surfaced in the receiver (2026-08-23).
    private final java.util.ArrayDeque<String> midiInTap = new java.util.ArrayDeque<>(64);
    private volatile long midiInChunks = 0, midiInBytes = 0, midiInRunningStatusUses = 0;

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

    /** Build everything: durable crash log first, then control plane, BLE-MIDI, watchdogs. */
    public void start() {
        // FIRST: arm durable crash/lifecycle logging so we capture WHY the bridge
        // dies (Diag is in-memory and dies with the process). Detects an unclean
        // previous death (the 2026-07-03 outage was unrecoverable after the fact).
        CrashLog.install(ctx);
        Log.i(TAG, "BridgeCore starting");

        // The notification itself is shell-owned; we only set its text.
        shell.updateNotification("Synth host running — control via kiosk");

        // The engine is shell-owned (the .so lives in the APK); the shell inits and
        // releases it. We only start/stop the stream.
        engine = (PianoEngine) shell.engine();
        if (engine == null) {
            Log.e(TAG, "shell.engine() is null — synth unavailable");
        }

        if (controlServer == null) {
            controlServer = new ControlServer(this);
            // On a hot swap the OLD payload's server has JUST been stopped and its
            // socket can still be closing, so the first bind races it (EADDRINUSE,
            // seen 2026-08-23 on the p4 rollback). Retry briefly rather than leave
            // :8770 dead until the next restart.
            // NanoHTTPD.start() does NOT throw on a bind failure — the listener thread
            // records it and dies, so "no exception" proves nothing. Check wasStarted()
            // AND that the listener is still alive a moment later; only then is the
            // port ours. Otherwise rebuild the server and retry (EADDRINUSE from the
            // previous payload's socket still closing is the common case).
            boolean bound = false;
            Exception last = null;
            for (int attempt = 1; attempt <= 15 && !bound; attempt++) {
                try {
                    if (attempt > 1) controlServer = new ControlServer(this); // a failed NanoHTTPD can't be restarted
                    controlServer.start(0, true); // 0 timeout = no socket read timeout; daemon thread.
                    Thread.sleep(150L);
                    bound = controlServer.wasStarted() && controlServer.isAlive();
                    if (bound) Log.i(TAG, "ControlServer BOUND on :" + ControlServer.PORT + " (attempt " + attempt + ") servedBy=" + ControlServer.BUILT_BY);
                    else { last = new IOException("listener died after start (port busy?)"); Thread.sleep(300L); }
                } catch (Exception e) {
                    last = e;
                    try { Thread.sleep(300L); } catch (InterruptedException ignored) { break; }
                }
            }
            if (!bound) {
                Log.e(TAG, "ControlServer FAILED to bind :" + ControlServer.PORT + " after retries", last);
                CrashLog.note("WS", "ControlServer failed to bind :" + ControlServer.PORT + " — " + (last == null ? "?" : last.getMessage()));
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

        // Outbound heartbeat — the only thing the tablet says unprompted. Same
        // create-once / update-config lifecycle as the guards.
        if (loopback == null) loopback = new Loopback(this);
        if (heartbeat == null) {
            heartbeat = new Heartbeat(this, config);
            heartbeat.start();
        } else {
            heartbeat.updateConfig(config);
        }
    }

    /** Tear down cleanly (before a payload swap or shell shutdown). */
    public void stop() {
        Log.i(TAG, "BridgeCore stopping");
        if (kioskWatchdog != null) { kioskWatchdog.stop(); kioskWatchdog = null; }
        if (kioskSettingsGuard != null) { kioskSettingsGuard.stop(); kioskSettingsGuard = null; }
        if (heartbeat != null) { heartbeat.stop(); heartbeat = null; }
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
            engine.stop(); // stream only — the shell owns init/release
        }
        engineRunning = false;
        engineDesired = false;
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
    public File getInstrumentsDir() { return new File(ctx.getExternalFilesDir(null), INSTRUMENTS_SUBDIR); }

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

    // --- BLE-MIDI input via BleMidiConnector ---

    /**
     * Start the BLE-MIDI connector: it scans for the configured piano BY MAC,
     * opens it via MidiManager.openBluetoothDevice() (which also registers it so
     * the browser's Web MIDI sees it), connects its output port to our receiver,
     * and auto-reconnects on drop. Replaces the old getDevices() approach, which
     * could only read a device some OTHER app had already paired.
     */
    private void startBleMidi() {
        if (config == null) config = DeviceConfig.load(ctx);
        // (Re)build the FKB screen-waker from the current config (fkbPassword etc.
        // may have changed via a pbctl /config edit → reloadConfigAndReconnect).
        if (screenWaker != null) screenWaker.shutdown();
        screenWaker = new ScreenWaker(config);

        // (Re)build the synthetic-touch un-throttler and SELF-ENABLE its
        // AccessibilityService over the LAN (WRITE_SECURE_SETTINGS) — no USB, no
        // manual toggle. The system binds PianoTouchService shortly after.
        touchPulser = new TouchPulser(config);
        if (config.tapWakeEnabled()) {
            // The a11y service is shell-owned (manifest-declared); name it by string so
            // the payload has no compile-time dependency on the shell class.
            String comp = new ComponentName(ctx, "net.kckern.pianobridge.PianoTouchService").flattenToString();
            org.json.JSONObject r = SettingsControl.enableAccessibilityService(ctx, comp);
            Log.i(TAG, "enableAccessibilityService " + comp + " -> " + r);
        }

        midiManager = (MidiManager) ctx.getSystemService(Context.MIDI_SERVICE);
        if (midiManager == null) {
            Log.e(TAG, "MidiManager unavailable on this device");
            return;
        }
        if (bleConnector == null) {
            bleConnector = new BleMidiConnector(ctx, config, new BleMidiConnector.Listener() {
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
            a2dpConnector = new A2dpConnector(ctx, config);
            a2dpConnector.start();
        } else {
            a2dpConnector.connectNow();
        }

        // Fail-closed audio guard. `engine` was taken from the shell in start() before
        // this method runs (and is never nulled by reloadConfigAndReconnect), so it is
        // non-null here — the spec's construction point is correct. Built once; on a
        // config reload teardownAudioGuard() clears it so it never holds a stale
        // A2dpConnector (see reloadConfigAndReconnect).
        if (audioGuard == null) {
            audioGuard = new AudioRouteGuard(
                    new AndroidAudioOps(ctx, a2dpConnector, engine, this::isEngineDesired));
            registerAudioRouteCallbacks(); // creates audioGuardThread/Handler
            // Hop off the BT broadcast/sweep thread: reconcile() now opens the audio HAL
            // via engine.start(), which must not stall A2DP reconnect handling.
            a2dpConnector.setOnStateChanged(() -> audioGuardHandler.post(this::safeReconcile));
        }
        // Fail-closed: assert desired state immediately. reconcile() does binder calls,
        // so run it OFF the main thread (start() may run on main). See Rule 3.
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
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
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
            ctx.registerReceiver(volumeReceiver,
                    new IntentFilter("android.media.VOLUME_CHANGED_ACTION"), null, audioGuardHandler);
        }
    }

    /** Unregister the audio-route callbacks and drop the guard (stop() / config reload). */
    private void teardownAudioGuard() {
        if (audioDeviceCallback != null) {
            AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                try { am.unregisterAudioDeviceCallback(audioDeviceCallback); } catch (Exception ignored) { }
            }
            audioDeviceCallback = null;
        }
        if (volumeReceiver != null) {
            try { ctx.unregisterReceiver(volumeReceiver); } catch (Exception ignored) { }
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
        if (kioskSettingsGuard != null) {
            // Shared path: sets the in-memory half AND persists, and logs a warning if
            // the persist fails rather than pretending the hold will survive a restart.
            kioskSettingsGuard.holdInstallUntil(until);
        }
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
            attemptOpenWritePort(device, 1);
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

    /**
     * One attempt to open the device's INPUT port — the write path to the piano.
     * Mirrors attemptOpenPort's defensiveness because it races the same Android-10
     * BLE-MIDI port-registration bug: openInputPort() can throw (or hand back null)
     * for a second or two after the device opens.
     *
     * Deliberately NON-fatal, unlike the read path. If every attempt fails we log and
     * leave midiWriteOpen false rather than forcing a BLE reconnect: a reconnect would
     * tear down the note-IN path that is (by then) already working, trading a working
     * direction for a broken one. A dead write path is visible in /status and
     * /diagnostics, and the next reconnect retries it anyway.
     */
    private synchronized void attemptOpenWritePort(MidiDevice device, int attempt) {
        if (device != openMidiDevice) return; // superseded by a newer connect/close
        MidiInputPort port = null;
        try {
            port = device.openInputPort(0);
        } catch (Throwable t) {
            midiWriteLastError = t.getClass().getSimpleName() + ": " + t.getMessage();
            Log.w(TAG, "openInputPort attempt " + attempt + " threw", t);
        }
        if (port != null) {
            openMidiInPort = port;
            midiWriteOpen = true;
            midiWriteLastError = null;
            Log.i(TAG, "MIDI input port (write path) connected (attempt " + attempt + ")");
            CrashLog.note("MIDI", "note-OUT port connected (attempt " + attempt + ")");
            return;
        }
        if (attempt >= MIDI_PORT_MAX_ATTEMPTS) {
            Log.e(TAG, "MIDI write port failed after " + attempt + " attempts — OUT stays closed");
            CrashLog.note("MIDI", "note-OUT port FAILED after " + attempt
                    + " attempts (" + midiWriteLastError + ")");
            return;
        }
        final MidiDevice d = device;
        final int next = attempt + 1;
        ensureMidiPortExec().schedule(() -> {
            try { attemptOpenWritePort(d, next); }
            catch (Throwable t) { Log.e(TAG, "write-port retry crashed", t); }
        }, MIDI_PORT_RETRY_MS, TimeUnit.MILLISECONDS);
    }

    /**
     * Write raw MIDI bytes to the piano. This is the whole point of the write path:
     * the caller hands over already-framed MIDI (including SysEx, which the kiosk
     * WebView is permanently forbidden from sending), and we put it on the wire.
     *
     * Fire-and-forget by nature — the MDG-400 has no read-back — so the honest return
     * value is "did we hand it to the port", not "did the piano act on it". Confirm
     * delivery at the far end with the JamCorder's `ble.in` counter
     * (cli/piano-midi-e2e.cli.mjs), which is outside this process's control.
     */
    public synchronized boolean sendMidi(byte[] bytes) {
        if (bytes == null || bytes.length == 0) return false;
        MidiInputPort port = openMidiInPort;
        if (port == null) {
            midiWriteLastError = "write port not open";
            return false;
        }
        try {
            port.send(bytes, 0, bytes.length);
            return true;
        } catch (Throwable t) {
            // A flap between the null-check and the send lands here. Mark the path
            // closed so /status stops advertising a port that no longer works; the
            // next device open re-runs attemptOpenWritePort.
            midiWriteOpen = false;
            midiWriteLastError = t.getClass().getSimpleName() + ": " + t.getMessage();
            Log.w(TAG, "sendMidi failed", t);
            return false;
        }
    }

    public boolean isMidiWriteOpen() { return midiWriteOpen; }

    public boolean isMidiPortOpen() { return midiPortOpen; }

    public Heartbeat getHeartbeat() { return heartbeat; }

    public Loopback getLoopback() { return loopback; }

    private void tapMidiIn(byte[] data, int offset, int count) {
        midiInChunks++; midiInBytes += count;
        StringBuilder sb = new StringBuilder(count * 3 + 16);
        sb.append(System.currentTimeMillis() % 100000).append(' ');
        for (int k = 0; k < count; k++) sb.append(String.format("%02X ", data[offset + k] & 0xFF));
        synchronized (midiInTap) { if (midiInTap.size() >= 64) midiInTap.pollFirst(); midiInTap.addLast(sb.toString().trim()); }
    }

    /** Last raw chunks from the read port + counters. The ground truth for "what did the parser get". */
    public org.json.JSONObject midiInTapSnapshot() {
        org.json.JSONObject o = new org.json.JSONObject();
        try {
            o.put("chunks", midiInChunks); o.put("bytes", midiInBytes); o.put("runningStatusUses", midiInRunningStatusUses);
            org.json.JSONArray a = new org.json.JSONArray();
            synchronized (midiInTap) { for (String c : midiInTap) a.put(c); }
            o.put("recent", a);
        } catch (Exception ignored) { }
        return o;
    }

    public String getMidiWriteLastError() { return midiWriteLastError; }

    /** The port-retry executor, created on first use. Shared by the read and write
     *  port openers; shut down in stop(). */
    private synchronized ScheduledExecutorService ensureMidiPortExec() {
        if (midiPortExec == null || midiPortExec.isShutdown()) {
            midiPortExec = Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "PianoBridge-midiport"); t.setDaemon(true); return t;
            });
        }
        return midiPortExec;
    }

    private void scheduleOpenPortRetry(final MidiDevice device, final int nextAttempt) {
        ensureMidiPortExec().schedule(() -> {
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

    /**
     * Re-read the device config from disk WITHOUT touching BLE-MIDI or A2DP.
     *
     * <p>For config writes that only concern the watchdogs — the kiosk-settings guard's
     * disarm and install-hold deadlines. Those are written with the merging
     * {@code writeOverride} while the piano is in use (or mid-install), so the full
     * {@link #reloadConfigAndReconnect()} is exactly wrong: it would drop the MIDI link
     * and the speaker. But SOME reload is required, because the guard reads the
     * persisted half of its deadlines through this cached {@code config} object — a
     * write that lands on disk without a reload leaves the guard reading the value it
     * loaded at startup, which is half of the v23 rearm bug.
     *
     * <p>Other components (ScreenWaker, TouchPulser, the connectors) keep the config
     * instance they were built with. Safe here because the merge only alters the guard
     * keys, which none of them read; a real reload rebuilds them.
     */
    public synchronized void reloadConfigOnly() {
        config = DeviceConfig.load(ctx);
        if (kioskWatchdog != null) kioskWatchdog.updateConfig(config);
        if (kioskSettingsGuard != null) kioskSettingsGuard.updateConfig(config);
        if (heartbeat != null) heartbeat.updateConfig(config);
    }

    /** Re-read the device config (after a pbctl /config edit) and reconnect. */
    public synchronized void reloadConfigAndReconnect() {
        config = DeviceConfig.load(ctx);
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
        if (heartbeat != null) heartbeat.updateConfig(config);
    }

    private synchronized void closeMidi() {
        midiPortOpen = false;
        midiWriteOpen = false;
        try {
            if (openMidiInPort != null) openMidiInPort.close();
        } catch (IOException e) {
            Log.w(TAG, "Error closing MIDI write port", e);
        } finally {
            openMidiInPort = null;
        }
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
     * MIDI running status IS handled (see runningStatus below). The earlier
     * note here — "not handled for brevity, most BLE-MIDI keyboards send full
     * status bytes" — was an assumption the hardware disproved on 2026-08-23:
     * the piano's echo reached this receiver as a data-first chunk and was
     * discarded as stray, which is also why some real notes had been vanishing.
     */
    private class PianoMidiReceiver extends MidiReceiver {
        // MIDI RUNNING STATUS: a sender may omit the status byte when it repeats the
        // previous one, so a chunk can legitimately START with a data byte. Treating
        // that as "stray" and skipping it dropped every running-status message on the
        // floor — which is how a piano echo reached the tablet (JamCorder bleOut +1)
        // yet never appeared in this receiver. Remember the last status across chunks.
        private int runningStatus = 0;

        @Override
        public void onSend(byte[] data, int offset, int count, long timestamp) {
            int i = offset;
            int end = offset + count;
            // Tap first, before any parsing decision can hide a byte.
            tapMidiIn(data, offset, count);
            while (i < end) {
                int status = data[i] & 0xFF;
                // `d` = index of the FIRST DATA byte of this message. With an explicit
                // status it is i+1; under running status the byte at i IS data, so d = i.
                int d;
                if (status < 0x80) {
                    // Data byte with no status: running status. If we know the last
                    // channel status, apply it; else the byte truly is stray.
                    if (runningStatus >= 0x80 && runningStatus < 0xF0) {
                        status = runningStatus;
                        midiInRunningStatusUses++;
                        d = i;
                    } else { i++; continue; }
                } else if (status < 0xF0) {
                    runningStatus = status; // channel message: becomes the running status
                    d = i + 1;
                } else if (status >= 0xF8) {
                    i++; continue; // realtime (clock/active-sense): never affects running status
                } else {
                    runningStatus = 0; // system common / SysEx: clears running status
                    d = i + 1;
                }
                int type = status & 0xF0;

                if (type == 0x90 && d + 1 < end) { // note on
                    int note = data[d] & 0x7F;
                    int vel = data[d + 1] & 0x7F;
                    // Loopback probe coming back from the piano: record the echo and
                    // swallow it — it must never light a key on screen or wake the display.
                    if (loopback != null && loopback.onInboundNote(status, note, vel)) { i = d + 2; continue; }
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
                    i = d + 2;
                } else if (type == 0x80 && d + 1 < end) { // note off
                    int note = data[d] & 0x7F;
                    if (loopback != null && (status & 0x0F) == Loopback.PROBE_CHANNEL && note == Loopback.PROBE_NOTE) { i = d + 2; continue; }
                    handleNoteOff(note);
                    i = d + 2;
                } else if (type == 0xB0 && d + 1 < end) { // control change
                    int cc = data[d] & 0x7F;
                    int val = data[d + 1] & 0x7F;
                    if (engine != null) engine.setParam("cc." + cc, val / 127f);
                    i = d + 2;
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
