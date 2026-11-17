package net.kckern.daylight.cap.audioguard;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Diag;
import net.kckern.daylight.core.LogEvents;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.BluetoothRole;

import org.json.JSONException;
import org.json.JSONObject;

public final class AudioGuardCapability implements Capability {
    private static final String TAG = "PianoBridge-WS";

    private CoreContext core;
    private SpeakerConfig config;
    private volatile AudioGuardHost host;
    private volatile AdapterCycler adapterCycler;
    private volatile boolean applying;
    /** The Bluetooth off-and-on cycle in flight, kept so stop() can end it. */
    private volatile Thread btCycle;
    static final long STOP_JOIN_MS = 3000;

    /** Test seam: a cycler over a fake adapter, with no Android context. */
    void useCyclerForTest(AdapterCycler cycler) { adapterCycler = cycler; }

    @Override public String name() { return "audio-guard"; }

    private A2dpConnector speaker() { AudioGuardHost h = host; return h == null ? null : h.speaker(); }
    private AudioRouteGuard guard() { AudioGuardHost h = host; return h == null ? null : h.guard(); }

    @Override public void register(CoreContext core) {
        this.core = core;
        SpeakerConfig.declare(core.settings());
        config = new SpeakerConfig(core.settings());
        core.settings().onChange(key -> {
            AudioGuardHost h = host;
            if (!applying && h != null && key.startsWith("speaker.") && !key.equals("speaker.name")) h.rebuild();
        });
        core.services().provide(BluetoothRole.class, new AudioRole());

        Router r = core.router();
        r.route("GET", "/speaker", req -> {
            A2dpConnector spk = speaker();
            if (spk == null) return Replies.json(Replies.err("no_a2dp"));
            AudioRouteGuard g = guard();
            return Replies.json(Replies.ok().put("speaker", spk.status()).put("guard", g != null ? g.status() : JSONObject.NULL));
        });
        r.route("POST", "/speaker", req -> {
            A2dpConnector spk = speaker();
            if (spk == null) return Replies.json(Replies.err("no_a2dp"));
            spk.connectNow();
            return Replies.json(Replies.ok().put("action", "speaker_connect"));
        });
        r.route("POST", "/speaker/reconnect", req -> {
            A2dpConnector spk = speaker();
            if (spk == null) return Replies.json(Replies.err("no_a2dp"));
            Diag.log(TAG, "/speaker/reconnect from " + req.remote);
            spk.reconnectNow();
            return Replies.json(Replies.ok().put("action", "speaker_reconnect"));
        });
        r.route("POST", "/speaker/bt-cycle", req -> {
            // Answers at once; the cycle runs on its own thread so the HTTP client, whose
            // link is about to drop along with BLE, cannot strand Bluetooth off.
            final AdapterCycler cycler = adapterCycler;
            if (cycler == null) return Replies.json(Replies.err("no_bluetooth"));
            final int settleMs = Math.max(0, Math.min(30000, Replies.intParam(req, "settleMs", 5000)));
            if (cycler.isRunning()) return Replies.json(Replies.err("busy"));
            Diag.log(TAG, "/speaker/bt-cycle settleMs=" + settleMs + " from " + req.remote);
            Thread t = new Thread(() -> {
                LogEvents.emit("bridge.bt-cycle.start", "info", new JSONObject());
                AdapterCycler.Result result = cycler.run(settleMs);
                JSONObject d = new JSONObject();
                try { d.put("ok", result.ok).put("error", result.error == null ? JSONObject.NULL : result.error).put("tookMs", result.tookMs); }
                catch (JSONException ignored) { }
                LogEvents.emit("bridge.bt-cycle.done", result.ok ? "info" : "error", d);
            }, "PianoBridge-bt-cycle");
            t.setDaemon(true);
            btCycle = t;
            t.start();
            return Replies.json(Replies.ok().put("action", "bt_cycle").put("settleMs", settleMs));
        });
        r.route("POST", "/audio-guard/bootstrap", req -> {
            // Spend the one-time exposure window on purpose: drop A2DP, let the guard clamp
            // the speaker index to 0, then reconnect.
            A2dpConnector spk = speaker();
            AudioRouteGuard g = guard();
            if (spk == null || g == null) return Replies.json(Replies.err("not_ready"));
            spk.disconnectNow();
            Thread.sleep(2500);
            g.reconcile();
            JSONObject after = g.status();
            spk.connectNow();
            return Replies.json(Replies.ok().put("action", "bootstrap").put("guard", after));
        });
        r.route("POST", "/audio-guard/volume-check", req -> {
            AudioGuardHost h = host;
            JSONObject st = h == null ? null : h.checkAudioVolumeNow();
            if (st == null) return Replies.json(Replies.err("not_ready"));
            if (st.optBoolean("raised")) {
                Diag.log(TAG, "/audio-guard/volume-check raised A2DP index from " + st.optInt("lastA2dpRaiseFrom") + " (" + req.remote + ")");
            }
            return Replies.json(Replies.ok().put("guard", st));
        });
        r.route("POST", "/audio-guard/override", req -> {
            AudioRouteGuard g = guard();
            if (g == null) return Replies.json(Replies.err("not_ready"));
            String ms = req.query.get("ms");
            long dur;
            try { dur = (ms == null) ? 60000L : Long.parseLong(ms); }
            catch (NumberFormatException e) { return Replies.json(Replies.err("bad_ms")); }
            dur = Math.min(600000L, Math.max(0L, dur));
            g.setOverrideUntil(System.currentTimeMillis() + dur);
            g.reconcile();
            return Replies.json(Replies.ok().put("overrideMs", dur).put("guard", g.status()));
        });

        StatusBoard board = core.status();
        board.add(StatusBoard.Surface.FRAME, name(), o -> {
            AudioRouteGuard g = guard();
            o.put("speakerOk", g != null && g.routeOk());
            o.put("speakerReason", g != null ? g.reason() : "no_guard");
        });
        board.add(StatusBoard.Surface.STATUS, name(), o -> {
            A2dpConnector spk = speaker();
            o.put("speaker", spk != null ? spk.status() : JSONObject.NULL);
        });
        board.add(StatusBoard.Surface.HEARTBEAT, name(), o -> {
            A2dpConnector spk = speaker();
            if (spk != null) o.put("speaker", spk.status().optBoolean("connected", false));
        });
        board.add(StatusBoard.Surface.DIAGNOSTICS, name(), o -> {
            A2dpConnector spk = speaker();
            AudioRouteGuard g = guard();
            o.put("speaker", spk != null ? spk.status() : JSONObject.NULL);
            o.put("guard", g != null ? g.status() : JSONObject.NULL);
        });
    }

    @Override public void start() {
        // No Android context: a JVM test of the whole payload, as with core's own services.
        // The routes then answer as they do before start.
        Context ctx = (Context) core.shell().context();
        if (ctx == null) return;
        adapterCycler = AdapterCycler.forDevice();
        AudioGuardHost h = new AudioGuardHost(ctx, config, core.services());
        h.start();
        host = h;
    }

    @Override public void stop() {
        // A cycle in flight is interrupted and waited for. The cycler asks for Bluetooth
        // to be switched on again on its way out, so an interrupt never leaves it off.
        Thread t = btCycle;
        btCycle = null;
        adapterCycler = null;
        if (t != null && t.isAlive()) {
            t.interrupt();
            try { t.join(STOP_JOIN_MS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        }
        AudioGuardHost h = host;
        host = null;
        if (h != null) h.stop();
    }

    /** The speaker, as bluetooth-controls sees it. */
    private final class AudioRole implements BluetoothRole {
        @Override public String profile() { return "audio"; }
        @Override public String address() { return config.speakerMac(); }
        @Override public String name() { return config.speakerName(); }
        @Override public boolean enabled() { return config.bluetoothAudioEnabled(); }
        @Override public boolean present() { return speaker() != null; }
        /** As before: whether the configured speaker is connected. The address is compared by the caller's plan. */
        @Override public boolean connectedTo(String address) { A2dpConnector spk = speaker(); return spk != null && spk.isTargetConnected(); }
        @Override public String connectedAddress() { return connectedTo(null) ? config.speakerMac() : ""; }
        @Override public void nudge() { A2dpConnector spk = speaker(); if (spk != null) spk.connectNow(); }
        @Override public void assign(String address, String name) {
            applying = true;
            try {
                core.settings().set("speaker.mac", address);
                core.settings().set("speaker.name", name);
                core.settings().set("speaker.enabled", true);
            } finally { applying = false; }
            AudioGuardHost h = host;
            if (h != null) h.rebuild();
        }
        @Override public void rename(String name) { core.settings().set("speaker.name", name); }
        @Override public void disable() { core.settings().set("speaker.enabled", false); }
        @Override public boolean pauseDiscovery() { return true; }
        @Override public void resumeDiscovery() { }
    }
}
