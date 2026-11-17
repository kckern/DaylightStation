package net.kckern.daylight.cap.volumekeys;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.LiveSwitch;
import net.kckern.daylight.core.MainThread;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.StatusBoard;

public final class VolumeKeysCapability implements Capability {
    private CoreContext core;
    private KeysConfig config;
    private volatile VolumeKeys keys;
    private volatile VolumeBeepGuard beepGuard;
    private volatile Context context;
    /**
     * volumeKeys.enabled: whether this app filters the volume keys and silences the
     * accessibility beep. Off while portal-keys still does both; on at the cutover.
     */
    private LiveSwitch keysSwitch;

    @Override public String name() { return "volume-keys"; }

    @Override public void register(CoreContext core) {
        this.core = core;
        KeysConfig.declare(core.settings());
        config = new KeysConfig(core.settings());
        keysSwitch = LiveSwitch.declare(core, "volumeKeys.enabled", new LiveSwitch.Part() {
            @Override public void acquire() { takeKeys(); }
            @Override public void release() { releaseKeys(); }
        });
        core.router().route("POST", "/accessibility/silence-beep", req -> {
            VolumeBeepGuard g = beepGuard;
            return Replies.json(g == null ? Replies.err("beep guard unavailable") : g.silence("request"));
        });
        core.status().add(StatusBoard.Surface.STATUS, name(), o -> {
            VolumeKeys k = keys;
            o.put("keysSeen", k == null ? 0 : k.keysSeen());
            // How many other keys passed the filter. Which keys they were is not kept anywhere.
            o.put("otherKeysSeen", k == null ? 0 : k.otherKeysSeen());
            if (k != null) o.put("displayOn", k.isPanelLit());
        });
    }

    @Override public void start() {
        Context shellContext = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: no keys to filter.
        if (shellContext == null) return;
        context = shellContext.getApplicationContext();
        keysSwitch.start();
    }

    private void takeKeys() {
        Context ctx = context;
        if (ctx == null) throw new IllegalStateException("not started");
        final VolumeKeys k = new VolumeKeys(ctx, core, config);
        k.start();
        // start() runs on a worker thread; the hub updates the accessibility service's
        // info when a filter is added, and that belongs on the main thread.
        MainThread.post(() -> core.accessibility().addKeyFilter(k));
        keys = k;
        try {
            VolumeBeepGuard g = new VolumeBeepGuard(ctx, core.shell());
            g.start();
            beepGuard = g;
        } catch (Throwable t) {
            // As portal-keys did: the keys still work without the guard.
            core.shell().note("PAYLOAD", "Volume beep guard start failed " + t);
        }
    }

    private void releaseKeys() {
        VolumeBeepGuard g = beepGuard;
        beepGuard = null;
        if (g != null) g.stop();
        final VolumeKeys k = keys;
        keys = null;
        if (k != null) {
            k.stop();
            // Posted like the add, so it cannot run before it: the filter is gone, and
            // with it the service's request for key events.
            MainThread.post(() -> core.accessibility().removeKeyFilter(k));
        }
    }

    @Override public void stop() {
        if (keysSwitch != null) keysSwitch.stop();
        releaseKeys();
    }
}
