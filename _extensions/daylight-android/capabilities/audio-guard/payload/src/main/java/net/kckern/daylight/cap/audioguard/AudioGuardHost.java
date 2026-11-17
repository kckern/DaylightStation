package net.kckern.daylight.cap.audioguard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Log;

import net.kckern.daylight.core.ServiceRegistry;
import net.kckern.daylight.core.spi.OutputGate;

import org.json.JSONException;
import org.json.JSONObject;

/** The speaker connector and the route guard, with the threads and callbacks that drive them. */
final class AudioGuardHost {
    private static final String TAG = "PianoBridge";

    private final Context ctx;
    private final SpeakerConfig config;
    private final ServiceRegistry services;

    // volatile: replaced under the lock, read by route handlers and status contributors.
    private volatile A2dpConnector a2dpConnector;
    // volatile: cleared on the caller's thread, read on audioGuardHandler.
    private volatile AudioRouteGuard audioGuard;
    private HandlerThread audioGuardThread;
    private Handler audioGuardHandler;
    private AudioDeviceCallback audioDeviceCallback;
    private BroadcastReceiver volumeReceiver;

    AudioGuardHost(Context ctx, SpeakerConfig config, ServiceRegistry services) {
        this.ctx = ctx;
        this.config = config;
        this.services = services;
    }

    A2dpConnector speaker() { return a2dpConnector; }
    AudioRouteGuard guard() { return audioGuard; }

    /** The A2DP and guard half of the old BridgeCore.startBleMidi(). */
    synchronized void start() {
        if (a2dpConnector == null) {
            a2dpConnector = new A2dpConnector(ctx, config);
            a2dpConnector.start();
        } else {
            a2dpConnector.connectNow();
        }
        if (audioGuard == null) {
            // The synth is looked up each time: it may be absent on this device, or
            // not started yet when the guard first reconciles.
            audioGuard = new AudioRouteGuard(new AndroidAudioOps(ctx, a2dpConnector, () -> services.find(OutputGate.class)));
            registerAudioRouteCallbacks(); // creates audioGuardThread/Handler
            // The handler is read when the state changes, not captured now: stop() clears it.
            a2dpConnector.setOnStateChanged(() -> {
                Handler h = audioGuardHandler;
                if (h != null) h.post(this::safeReconcile);
            });
        }
        // Fail closed: assert the desired state at once, off the caller's thread.
        if (audioGuardHandler != null) audioGuardHandler.post(this::safeReconcile);
    }

    /** After a speaker.* setting change: the speaker half of the old reloadConfigAndReconnect(). */
    synchronized void rebuild() {
        if (a2dpConnector != null) { a2dpConnector.stop(); a2dpConnector = null; }
        teardownAudioGuard();
        start();
    }

    synchronized void stop() {
        if (a2dpConnector != null) { a2dpConnector.stop(); a2dpConnector = null; }
        teardownAudioGuard();
        if (audioGuardThread != null) { audioGuardThread.quitSafely(); audioGuardThread = null; audioGuardHandler = null; }
    }

    // --- copied from BridgeCore, unchanged ---

    /** Reconcile on the guard thread, null-safe and crash-safe: an uncaught throw on a
     *  Handler thread would kill the process (dark tablet in a sealed box). */
    private void safeReconcile() {
        AudioRouteGuard g = audioGuard;
        if (g == null) return;
        try { g.reconcile(); } catch (Throwable t) { Log.w(TAG, "reconcile threw", t); }
        // The A2DP volume floor waits out a settle window after a connect; a steady
        // route fires no further edges, so schedule the follow-up ourselves.
        Handler h = audioGuardHandler;
        long recheck = g.recheckInMs();
        if (h != null) {
            h.removeCallbacks(guardRecheck);
            if (recheck > 0) h.postDelayed(guardRecheck, recheck + 50);
        }
    }
    private final Runnable guardRecheck = this::safeReconcile;

    /**
     * Run the guard NOW on the caller's thread (reconcile() is synchronized) and say
     * whether the A2DP floor had to raise the index. Backs POST /audio-guard/volume-check,
     * which the kiosk calls on every Media Volume press: a UI "max" over an OS index of
     * 0/15 is still silence, so the press itself must verify the OS level.
     */
    JSONObject checkAudioVolumeNow() throws JSONException {
        AudioRouteGuard g = audioGuard;
        if (g == null) return null;
        int before = g.a2dpRaises();
        safeReconcile();
        return g.status().put("raised", g.a2dpRaises() > before);
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
}
