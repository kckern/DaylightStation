package net.kckern.daylight.cap.synth;

import android.content.Context;
import android.util.Log;

import net.kckern.daylight.cap.synth.shell.PianoEngine;
import net.kckern.daylight.core.SocketHub;
import net.kckern.daylight.core.spi.NoteListener;
import net.kckern.daylight.core.spi.OutputGate;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;

/** Drives the shell-owned native engine. Holds no audio state of its own beyond intent. */
final class SynthHost implements OutputGate, NoteListener {
    private static final String TAG = "PianoBridge";
    /** Subdir of the app's external files dir where instrument assets live. */
    static final String INSTRUMENTS_SUBDIR = "piano-instruments";

    private final Context ctx;
    private volatile PianoEngine engine;
    private volatile boolean engineRunning = false;
    /** The kiosk's intent (engine.start / engine.stop), distinct from whether the stream is open. */
    private volatile boolean engineDesired = false;
    private volatile String currentPresetId = null;

    SynthHost(Context ctx) { this.ctx = ctx; }

    /** The shell component, or null when the shell has no engine. */
    void bind(Object component) {
        engine = component instanceof PianoEngine ? (PianoEngine) component : null;
        if (engine == null) Log.e(TAG, "no synth-engine component: synth unavailable");
    }

    PianoEngine engine() { return engine; }
    String presetId() { return currentPresetId; }

    /** Native stream state is the truth; the flag goes stale when an Oboe error closes the stream. */
    boolean isEngineRunning() { PianoEngine e = engine; return e != null && e.isStreamRunning(); }

    /** No storage permission needed, and readable by native code. */
    File instrumentsDir() { return new File(ctx.getExternalFilesDir(null), INSTRUMENTS_SUBDIR); }

    synchronized void engineStart() {
        engineDesired = true;
        PianoEngine e = engine;
        if (e == null) { Log.w(TAG, "engineStart: no engine"); return; }
        if (e.isStreamRunning()) return;
        engineRunning = e.start();
        Log.i(TAG, "engineStart running=" + engineRunning);
    }

    synchronized void engineStop() {
        engineDesired = false;
        PianoEngine e = engine;
        if (e == null) return;
        e.stop();
        engineRunning = false;
        Log.i(TAG, "engineStop");
    }

    /** Payload stop: the stream only. The shell owns init and release. */
    void stop() {
        PianoEngine e = engine;
        if (e != null) e.stop();
        engineRunning = false;
        engineDesired = false;
    }

    // --- OutputGate: asked by audio-guard ---

    @Override public void setOpen(boolean open) {
        PianoEngine e = engine;
        if (e == null) return;
        // The gate is asserted unconditionally: fail closed, always.
        e.setOutputGate(open);
        // The stream is reopened only for a synth the kiosk asked for. After an A2DP drop
        // the stream stays closed on purpose, so this is the one recovery path; tying it
        // to intent avoids holding the audio HAL open on an idle kiosk. start() is
        // idempotent natively, and this runs only once the route is confirmed again.
        if (open && engineDesired && !e.isStreamRunning()) e.start();
    }

    // --- NoteListener: live notes from midi-bridge ---

    @Override public void noteOn(int note, int velocity, long epochMs) { PianoEngine e = engine; if (e != null) e.noteOn(note, velocity); }
    @Override public void noteOff(int note, long epochMs) { PianoEngine e = engine; if (e != null) e.noteOff(note); }
    @Override public void controlChange(int controller, int value) { PianoEngine e = engine; if (e != null) e.setParam("cc." + controller, value / 127f); }

    // --- preset.load ---

    void loadPreset(JSONObject spec, SocketHub.Reply reply) {
        PianoEngine e = engine;
        if (e == null) { reply.error("no_engine", "engine not initialized"); return; }
        String engineName = spec.optString("engine", "");
        String asset = spec.optString("asset", "");
        String resolved = resolveAsset(asset);
        if (resolved == null) { reply.error("bad_asset", "asset path rejected: " + asset); return; }
        int patch = spec.optInt("patch", 0);
        float gainDb = (float) spec.optDouble("gain_db", 0.0);
        int transpose = spec.optInt("transpose", 0);
        int tune = spec.optInt("tune", 0);
        String velCurve = spec.optString("velocity_curve", "natural");
        // reverb may be null or an object with a "mix" field.
        float reverbMix = 0f;
        JSONObject reverb = spec.optJSONObject("reverb");
        if (reverb != null) reverbMix = (float) reverb.optDouble("mix", 0.0);

        boolean ok = e.loadPreset(engineName, resolved, patch, gainDb, transpose, tune, velCurve, reverbMix);
        if (ok) {
            currentPresetId = spec.optString("id", null);
            Log.i(TAG, "preset loaded id=" + currentPresetId + " engine=" + engineName);
        } else {
            reply.error("preset_failed", "engine refused preset " + spec.optString("id", "?"));
        }
    }

    /** The absolute path of an asset under the instruments dir, or null when it would escape it. */
    private String resolveAsset(String asset) {
        if (asset == null || asset.isEmpty()) return null;
        // Reject traversal, absolute paths and backslashes up front (mirrors instrumentSpec.js SAFE()).
        if (asset.contains("..") || asset.startsWith("/") || asset.contains("\\")) {
            Log.e(TAG, "Rejected unsafe asset path: " + asset);
            return null;
        }
        File root = instrumentsDir();
        File target = new File(root, asset);
        try {
            String rootCanon = root.getCanonicalPath();
            String targetCanon = target.getCanonicalPath();
            // The canonical path must stay within the root.
            if (!targetCanon.equals(rootCanon) && !targetCanon.startsWith(rootCanon + File.separator)) {
                Log.e(TAG, "Asset escapes instruments root: " + targetCanon);
                return null;
            }
            return targetCanon;
        } catch (IOException ex) {
            Log.e(TAG, "Asset canonicalization failed for " + asset, ex);
            return null;
        }
    }
}
