package net.kckern.daylight.cap.midibridge;

import android.content.Context;
import android.media.midi.MidiDevice;
import android.media.midi.MidiInputPort;
import android.media.midi.MidiManager;
import android.media.midi.MidiOutputPort;
import android.media.midi.MidiReceiver;
import android.util.Log;

import net.kckern.daylight.core.CrashLog;
import net.kckern.daylight.core.NoteBus;
import net.kckern.daylight.core.SocketHub;

import org.json.JSONObject;

import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * MidiLink: the MIDI half of the old piano-bridge BridgeCore. Reads the BLE-MIDI
 * instrument through MidiManager, writes raw MIDI (SysEx included) back to it, and
 * hands live notes to the core: the NoteBus first, then the control WebSocket.
 */
public class MidiLink {

    private static final String TAG = "PianoBridge";

    private final Context ctx;
    private final MidiConfig config;
    private final NoteBus notes;
    private final SocketHub socket;

    MidiLink(Context ctx, MidiConfig config, NoteBus notes, SocketHub socket) {
        this.ctx = ctx;
        this.config = config;
        this.notes = notes;
        this.socket = socket;
    }

    public Context getContext() { return ctx; }

    /** Test seam: a link with its loopback and no Android context, connector or ports. */
    static MidiLink forTest(MidiConfig config, NoteBus notes, SocketHub socket) {
        MidiLink l = new MidiLink(null, config, notes, socket);
        l.loopback = new Loopback(l);
        return l;
    }

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

    private BleMidiConnector bleConnector;
    private Loopback loopback;
    // Raw MIDI-IN tap: the last chunks the read port delivered, exactly as received.
    // The only way to see what the parser is actually being handed — added when a
    // piano echo provably reached the tablet (JamCorder bleOut +1) but never
    // surfaced in the receiver (2026-08-23).
    private final java.util.ArrayDeque<String> midiInTap = new java.util.ArrayDeque<>(64);
    private volatile long midiInChunks = 0, midiInBytes = 0, midiInRunningStatusUses = 0;

    /** The connector half of the old startBleMidi(). */
    public synchronized void start() {
        stopped = false;
        if (loopback == null) loopback = new Loopback(this);
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
    }

    /** Set by stop(). A force-reset ladder that is running sees it and takes no further step. */
    private volatile boolean stopped;

    public void stop() {
        stopped = true;
        // Before taking the lock: the reset thread may need it to finish.
        Loopback lb = loopback;
        if (lb != null) lb.stop();
        synchronized (this) {
            if (bleConnector != null) { bleConnector.stop(); bleConnector = null; }
            if (midiPortExec != null) { midiPortExec.shutdownNow(); midiPortExec = null; }
            closeMidi();
        }
    }

    /** After a midi.* setting change: the MIDI half of the old reloadConfigAndReconnect(). */
    public synchronized void reconnect() {
        if (bleConnector != null) { bleConnector.stop(); bleConnector = null; }
        closeMidi();
        start();
    }

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

    /**
     * Schedule a MIDI message {@code delayMs} from now on the bridge's own clock.
     * This is the jank-immune audio plane for score/composer/studio playback: the
     * kiosk page dispatches events up to ~400ms ahead (its transport lookahead),
     * and THIS process's timer fires them on time regardless of how badly the
     * WebView main thread is starving. Replaces Web MIDI's timestamped send()
     * (out.send(bytes, atMs)) — the handle that fails silently when zombie.
     * delayMs <= 0 sends immediately.
     */
    public boolean scheduleMidi(byte[] bytes, long delayMs) {
        if (bytes == null || bytes.length == 0) return false;
        if (delayMs <= 0) return sendMidi(bytes);
        if (openMidiInPort == null) { midiWriteLastError = "write port not open"; return false; }
        ensureMidiPortExec().schedule(() -> {
            if (!sendMidi(bytes)) Log.w(TAG, "scheduled sendMidi failed (delayMs=" + delayMs + ")");
        }, delayMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        return true;
    }

    public boolean isMidiWriteOpen() { return midiWriteOpen; }

    public boolean isMidiPortOpen() { return midiPortOpen; }

    public Loopback getLoopback() { return loopback; }

    /**
     * Escalating force-reset of the MIDI link, verified by the piano's echo at each
     * step. This is what the Operator drawer's reset SHOULD have been doing all along.
     * Runs on a worker thread (BLE ops + waits); returns a JSON verdict.
     */
    public org.json.JSONObject forceResetLink() {
        org.json.JSONObject o = new org.json.JSONObject();
        org.json.JSONArray steps = new org.json.JSONArray();
        try {
            CrashLog.note("RESET", "force-reset requested");
            if (stopped) return o.put("error", "stopped").put("steps", steps);
            // L1: forget + reconnect the BLE device (drops both ports, re-opens fresh).
            steps.put(step("L1 BLE reconnect", () -> {
                if (bleConnector != null) { bleConnector.forget(); sleepMs(1200); bleConnector.connectNow(); }
                waitConnected(12000);
            }));
            if (verifyEcho()) { o.put("fixed", true).put("recoveredAt", "L1").put("steps", steps); return finishReset(o); }
            // The radio is not bounced for a link that is being torn down.
            if (stopped) return o.put("error", "stopped").put("steps", steps);

            // L2: bounce the tablet's Bluetooth radio (BLUETOOTH_ADMIN). The nuclear
            // option for a stack-level zombie the connector alone can't clear.
            steps.put(step("L2 radio bounce", () -> {
                android.bluetooth.BluetoothAdapter a = android.bluetooth.BluetoothAdapter.getDefaultAdapter();
                if (a != null) {
                    try { a.disable(); } catch (Throwable ignored) {}
                    sleepMs(3000);
                    try { a.enable(); } catch (Throwable ignored) {}
                    sleepMs(6000);
                }
                if (bleConnector != null) bleConnector.connectNow();
                waitConnected(15000);
            }));
            resetVerdict(o, verifyEcho(), "L2").put("steps", steps);
            return finishReset(o);
        } catch (Throwable t) {
            try { o.put("error", t.getClass().getSimpleName() + ": " + t.getMessage()).put("steps", steps); } catch (Exception ignored) {}
            return o;
        }
    }

    private org.json.JSONObject finishReset(org.json.JSONObject o) {
        try {
            boolean fixed = o.optBoolean("fixed");
            CrashLog.note("RESET", fixed ? "force-reset OK (" + o.optString("recoveredAt") + ")" : "force-reset FAILED — still down");
            o.put("linkVerdict", loopback != null && loopback.snapshot().optBoolean("outVerified") ? "VERIFIED" : "DOWN");
            o.put("ok", true);
        } catch (Exception ignored) {}
        return o;
    }

    private interface ResetStep { void run() throws Exception; }
    private org.json.JSONObject step(String name, ResetStep body) {
        org.json.JSONObject s = new org.json.JSONObject();
        long t0 = System.currentTimeMillis();
        try { body.run(); s.put("step", name).put("ms", System.currentTimeMillis() - t0); }
        catch (Exception e) { try { s.put("step", name).put("error", e.getMessage()); } catch (Exception ignored) {} }
        return s;
    }
    boolean verifyEcho() { return loopback != null && loopback.probeAndWait().optBoolean("echoed"); }

    /** The last rung's verdict. */
    org.json.JSONObject resetVerdict(boolean fixed, String rung) throws org.json.JSONException {
        return resetVerdict(new org.json.JSONObject(), fixed, rung);
    }

    private org.json.JSONObject resetVerdict(org.json.JSONObject o, boolean fixed, String rung) throws org.json.JSONException {
        o.put("fixed", fixed).put("recoveredAt", fixed ? rung : JSONObject.NULL);
        if (!fixed && !midiWriteOpen) {
            // No probe could be written, so the echo check says nothing about the piano.
            o.put("reason", Loopback.REASON_WRITE_PORT_CLOSED);
            o.put("verdict", "STILL DOWN: the MIDI write port did not open after the reset");
        } else if (!fixed) {
            o.put("verdict", "STILL DOWN after radio bounce — likely physical (JamCorder/USB/piano power)");
        }
        return o;
    }
    /**
     * An interrupt ends the wait and stays set, so every later wait in the ladder ends
     * at once too. Steps already begun still finish: Bluetooth that was switched off
     * is switched on again, only without the settling time.
     */
    private void sleepMs(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
    private void waitConnected(long budgetMs) {
        long end = System.currentTimeMillis() + budgetMs;
        while (System.currentTimeMillis() < end && !stopped && !Thread.currentThread().isInterrupted()) {
            org.json.JSONObject st = bleConnector == null ? null : bleConnector.status();
            if (st != null && "CONNECTED".equals(st.optString("state"))) return;
            sleepMs(500);
        }
    }

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

    // --- accessors used by MidiBridgeCapability ---

    public BleMidiConnector getBleConnector() { return bleConnector; }

    public MidiConfig getConfig() { return config; }

    /** Test seam: the receiver the read port is connected to, without a MidiDevice. */
    MidiReceiver receiverForTest() { return new PianoMidiReceiver(); }

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
     * Parses raw MIDI bytes into note-on/off + CC, publishes them on the NoteBus
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
            // Epoch ms of this MIDI event, from the receiver's nanoTime-based timestamp.
            // Sampled once per chunk: every message in one BLE packet shares `timestamp`.
            long t = MidiWire.midiEventEpochMs(timestamp, System.currentTimeMillis(), System.nanoTime());
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
                        handleNoteOff(note, t);
                    } else {
                        // Subscribers first (the synth, so sound comes before anything else;
                        // from phase 3 also the screen wake and the touch pulse), then the page.
                        notes.noteOn(note, vel, t);
                        socket.broadcast(MidiWire.buildNote("note.on", note, vel, t));
                    }
                    i = d + 2;
                } else if (type == 0x80 && d + 1 < end) { // note off
                    int note = data[d] & 0x7F;
                    if (loopback != null && note == Loopback.PROBE_NOTE) { i = d + 2; continue; }
                    handleNoteOff(note, t);
                    i = d + 2;
                } else if (type == 0xB0 && d + 1 < end) { // control change
                    int cc = data[d] & 0x7F;
                    int val = data[d + 1] & 0x7F;
                    notes.controlChange(cc, val);
                    i = d + 2;
                } else {
                    // Unhandled status (pitch bend, aftertouch, sysex, etc.) — skip 1.
                    i++;
                }
            }
        }

        private void handleNoteOff(int note, long t) {
            notes.noteOff(note, t);
            socket.broadcast(MidiWire.buildNote("note.off", note, -1, t));
        }
    }
}
