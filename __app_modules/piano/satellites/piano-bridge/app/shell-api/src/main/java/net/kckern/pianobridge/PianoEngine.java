package net.kckern.pianobridge;

import android.util.Log;

/**
 * PianoEngine — thin JNI facade over the native multi-engine synth host
 * (VoiceHost + OboeOutput, see src/main/cpp). All audio work happens in C++;
 * this class only marshals calls across the JNI boundary.
 *
 * The native methods are implemented in native-lib.cpp. When sfizz/dexed are
 * not yet vendored (HAVE_SFIZZ / HAVE_DEXED undefined), the native engines
 * render SILENCE rather than failing — so these calls always succeed and the
 * control/transport plumbing can be exercised end-to-end before the DSP exists.
 */
public final class PianoEngine {

    private static final String TAG = "PianoBridge";

    static {
        // Loads libpianobridge.so (built by CMakeLists.txt).
        System.loadLibrary("pianobridge");
    }

    private long handle = 0L; // opaque pointer to the native VoiceHost/Output bundle

    /** Allocate native resources. Must be called before any other method. */
    public synchronized boolean init() {
        if (handle != 0L) {
            Log.w(TAG, "PianoEngine.init called twice; ignoring");
            return true;
        }
        handle = nativeInit();
        Log.i(TAG, "PianoEngine.init handle=" + handle);
        return handle != 0L;
    }

    /** Open the Oboe output stream and begin pulling render(). */
    public synchronized boolean start() {
        if (handle == 0L) { Log.e(TAG, "start before init"); return false; }
        boolean ok = nativeStart(handle);
        Log.i(TAG, "PianoEngine.start ok=" + ok);
        return ok;
    }

    /** Stop the Oboe output stream (engine state preserved). */
    public synchronized void stop() {
        if (handle == 0L) return;
        nativeStop(handle);
        Log.i(TAG, "PianoEngine.stop");
    }

    /**
     * Swap the active voice. Fields mirror the WS preset.load "spec" contract
     * (instrumentSpec.js): engine, asset, patch, gain_db, transpose, tune,
     * velocity_curve, reverb mix.
     *
     * @param engine        "sfizz" | "dexed"
     * @param assetPath     instrument-relative asset path (already guarded by ControlServer)
     * @param patch         dexed bank/patch index; ignored by sfizz
     * @param gainDb        output trim in dB
     * @param transpose     semitone transpose
     * @param tune          fine tune in cents
     * @param velocityCurve "natural" | "linear" | "soft" | "hard"
     * @param reverbMix     0..1 reverb wet mix (0 if no reverb requested)
     */
    public synchronized boolean loadPreset(String engine, String assetPath, int patch,
                                           float gainDb, int transpose, int tune,
                                           String velocityCurve, float reverbMix) {
        if (handle == 0L) { Log.e(TAG, "loadPreset before init"); return false; }
        boolean ok = nativeLoadPreset(handle, engine, assetPath, patch, gainDb,
                transpose, tune, velocityCurve, reverbMix);
        Log.i(TAG, "PianoEngine.loadPreset engine=" + engine + " asset=" + assetPath
                + " patch=" + patch + " ok=" + ok);
        return ok;
    }

    /** Generic parameter setter. path is a dotted spec path (e.g. "reverb.mix"). */
    public synchronized void setParam(String path, float value) {
        if (handle == 0L) return;
        nativeSetParam(handle, path, value);
        Log.d(TAG, "PianoEngine.setParam " + path + "=" + value);
    }

    public synchronized void noteOn(int note, int velocity) {
        if (handle == 0L) return;
        nativeNoteOn(handle, note, velocity);
    }

    public synchronized void noteOff(int note) {
        if (handle == 0L) return;
        nativeNoteOff(handle, note);
    }

    /** All-notes-off + flush voices. */
    public synchronized void panic() {
        if (handle == 0L) return;
        nativePanic(handle);
        Log.i(TAG, "PianoEngine.panic");
    }

    /**
     * Open/close the fail-closed output gate. Closed = VoiceHost renders silence
     * regardless of engine state. Cheap and idempotent; called by the reconciler.
     */
    public synchronized void setOutputGate(boolean open) {
        if (handle == 0L) return;
        nativeSetOutputGate(handle, open);
    }

    /** @return true iff the native Oboe output stream is open and started. */
    public synchronized boolean isStreamRunning() {
        if (handle == 0L) return false;
        return nativeIsStreamRunning(handle);
    }

    /** Free native resources. The instance must not be used afterward. */
    public synchronized void release() {
        if (handle == 0L) return;
        nativeRelease(handle);
        Log.i(TAG, "PianoEngine.release");
        handle = 0L;
    }

    /** @return native CPU load estimate (0..1), or -1 if unavailable. */
    public synchronized float cpuLoad() {
        if (handle == 0L) return -1f;
        return nativeCpuLoad(handle);
    }

    /** @return cumulative Oboe xrun (underrun) count, or -1 if unavailable. */
    public synchronized int xruns() {
        if (handle == 0L) return -1;
        return nativeXruns(handle);
    }

    // --- native method declarations (implemented in native-lib.cpp) ---

    private static native long nativeInit();
    private static native boolean nativeStart(long handle);
    private static native void nativeStop(long handle);
    private static native boolean nativeLoadPreset(long handle, String engine, String assetPath,
                                                   int patch, float gainDb, int transpose, int tune,
                                                   String velocityCurve, float reverbMix);
    private static native void nativeSetParam(long handle, String path, float value);
    private static native void nativeNoteOn(long handle, int note, int velocity);
    private static native void nativeNoteOff(long handle, int note);
    private static native void nativePanic(long handle);
    private static native void nativeSetOutputGate(long handle, boolean open);
    private static native boolean nativeIsStreamRunning(long handle);
    private static native void nativeRelease(long handle);
    private static native float nativeCpuLoad(long handle);
    private static native int nativeXruns(long handle);
}
