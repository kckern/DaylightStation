package net.kckern.daylight.core;

import org.json.JSONObject;

/**
 * A BOOLEAN setting that decides whether a capability holds a piece of hardware, applied
 * the moment it changes: acquire on true, release on false.
 *
 * Why it exists: the new app is installed beside the old helper apps before a device is
 * switched over. Two apps cannot both claim the Portal's USB keyboard, hold the BLE-MIDI
 * link, drive the speaker, or stream the microphone. Each such part has a switch; the
 * kiosk device files compile them to false, and they are turned on at that device's
 * cutover, without a payload restart.
 *
 * Every switch is reported in GET /status under "switches", as whether the part is held.
 */
public final class LiveSwitch {
    /** The part behind the switch. */
    public interface Part {
        /** Take the hardware. May throw; the switch then reports the part as not held. */
        void acquire() throws Exception;
        /** Give it back. Must not throw, and must tolerate a part that was only half taken. */
        void release();
    }

    private final CoreContext core;
    private final String key;
    private final Part part;
    private boolean started;
    private boolean held;
    private volatile String error;

    private LiveSwitch(CoreContext core, String key, Part part) {
        this.core = core;
        this.key = key;
        this.part = part;
    }

    /**
     * Declare {@code key} (BOOLEAN, on unless a device file says otherwise), listen for
     * changes to it and report it in /status. Call from a capability's register().
     */
    public static LiveSwitch declare(CoreContext core, String key, Part part) {
        core.settings().declare(key, SettingsRegistry.Type.BOOLEAN, true);
        return attach(core, key, part);
    }

    /** As declare, for a setting the capability has already declared. */
    public static LiveSwitch attach(CoreContext core, final String key, Part part) {
        final LiveSwitch s = new LiveSwitch(core, key, part);
        core.settings().onChange(changed -> { if (key.equals(changed)) s.apply(); });
        core.status().add(StatusBoard.Surface.STATUS, key, s::report);
        return s;
    }

    /**
     * For a switch whose capability applies it itself (the MIDI link reads midi.enabled at
     * every connect decision): only the /status row, in the same shape.
     */
    public static void report(final CoreContext core, final String key, final java.util.function.BooleanSupplier active) {
        core.status().add(StatusBoard.Surface.STATUS, key, into -> {
            JSONObject switches = into.optJSONObject("switches");
            if (switches == null) { switches = new JSONObject(); into.put("switches", switches); }
            switches.put(key, new JSONObject().put("setting", core.settings().get(key)).put("active", active.getAsBoolean()));
        });
    }

    /** The setting's value now. */
    public boolean wanted() { return (Boolean) core.settings().get(key); }

    /** True while the part is held. */
    public synchronized boolean held() { return held; }

    /** The capability started: take the part if the switch is on. */
    public void start() {
        synchronized (this) { started = true; }
        apply();
    }

    /** The capability stopped: release the part. Safe to call twice and before start(). */
    public synchronized void stop() {
        started = false;
        if (!held) return;
        held = false;
        try { part.release(); } catch (Throwable ignored) { }
    }

    private synchronized void apply() {
        boolean want = started && wanted();
        if (want == held) return;
        if (want) {
            try {
                part.acquire();
                held = true;
                error = null;
                note("on");
            } catch (Throwable t) {
                error = t.getClass().getSimpleName() + ": " + t.getMessage();
                // What was taken before the failure is given back.
                try { part.release(); } catch (Throwable ignored) { }
                note("could not be turned on: " + error);
            }
        } else {
            held = false;
            try { part.release(); } catch (Throwable ignored) { }
            note("off");
        }
    }

    private void note(String what) {
        try { if (core.shell() != null) core.shell().note("SWITCH", key + " " + what); } catch (Throwable ignored) { }
    }

    private void report(JSONObject into) throws Exception {
        JSONObject switches = into.optJSONObject("switches");
        if (switches == null) { switches = new JSONObject(); into.put("switches", switches); }
        JSONObject row = new JSONObject().put("setting", wanted()).put("active", held());
        String e = error;
        if (e != null) row.put("error", e);
        switches.put(key, row);
    }
}
