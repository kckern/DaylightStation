package net.kckern.daylight.cap.synth;

import android.content.Context;

import net.kckern.daylight.cap.synth.shell.PianoEngine;
import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.SocketHub;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.OutputGate;

import org.json.JSONObject;

public final class SynthCapability implements Capability {
    /** Published by the shell half's SynthEngineProvider. */
    private static final String COMPONENT = "synth-engine";
    /** Published by the same provider when the engine could not be set up: what went wrong. */
    private static final String ERROR_COMPONENT = "synth-engine-error";

    private CoreContext core;
    private volatile SynthHost host;

    @Override public String name() { return "synth"; }

    private PianoEngine engine() { SynthHost h = host; return h == null ? null : h.engine(); }

    @Override public void register(CoreContext core) {
        this.core = core;
        SocketHub socket = core.socket();
        socket.on("engine.start", (m, reply) -> { SynthHost h = host; if (h != null) h.engineStart(); });
        socket.on("engine.stop", (m, reply) -> { SynthHost h = host; if (h != null) h.engineStop(); });
        socket.on("preset.load", (m, reply) -> {
            JSONObject spec = m.optJSONObject("spec");
            if (spec == null) { reply.error("no_spec", "preset.load missing spec"); return; }
            SynthHost h = host;
            if (h == null) { reply.error("no_engine", "engine not initialized"); return; }
            h.loadPreset(spec, reply);
        });
        socket.on("param.set", (m, reply) -> {
            String path = m.optString("path", null);
            if (path == null) { reply.error("no_path", "param.set missing path"); return; }
            PianoEngine e = engine();
            if (e != null) e.setParam(path, (float) m.optDouble("value", 0.0));
        });
        socket.on("panic", (m, reply) -> { PianoEngine e = engine(); if (e != null) e.panic(); });
        // Relay fallback: the page forwards MIDI it read itself to the internal synth.
        socket.on("note.on", (m, reply) -> {
            int note = m.optInt("note", -1);
            PianoEngine e = engine();
            if (note >= 0 && e != null) e.noteOn(note, m.optInt("velocity", 64));
        });
        socket.on("note.off", (m, reply) -> {
            int note = m.optInt("note", -1);
            PianoEngine e = engine();
            if (note >= 0 && e != null) e.noteOff(note);
        });

        core.router().route("POST", "/panic", req -> {
            PianoEngine e = engine();
            if (e != null) e.panic();
            return Replies.json(Replies.ok().put("action", "panic"));
        });

        StatusBoard board = core.status();
        board.add(StatusBoard.Surface.FRAME, name(), o -> {
            SynthHost h = host;
            PianoEngine e = engine();
            o.put("engine", h != null && h.isEngineRunning() ? "running" : "stopped");
            o.put("preset", h == null || h.presetId() == null ? JSONObject.NULL : h.presetId());
            o.put("cpu", e != null ? e.cpuLoad() : -1);
            o.put("xruns", e != null ? e.xruns() : -1);
        });
        StatusBoard.Contributor engineState = o -> {
            SynthHost h = host;
            Object error = core.components().get(ERROR_COMPONENT);
            String state = engineState(h != null, h != null && h.engine() != null, h != null && h.isEngineRunning(),
                    error == null ? null : String.valueOf(error));
            o.put("engine", state);
            if (LOAD_FAILED.equals(state)) o.put("engineError", error == null ? "no_engine_component" : String.valueOf(error));
            o.put("preset", h == null || h.presetId() == null ? JSONObject.NULL : h.presetId());
        };
        board.add(StatusBoard.Surface.STATUS, name(), engineState);
        board.add(StatusBoard.Surface.DIAGNOSTICS, name(), engineState);
    }

    static final String LOAD_FAILED = "load_failed";

    /**
     * What GET /status says of the engine. "stopped" is an engine that could play and
     * is idle. "load_failed" is one that never will in this process: the shell
     * reported an error while setting it up, or the capability started and found no
     * engine at all (the native library did not load).
     */
    static String engineState(boolean started, boolean engineBound, boolean running, String loadError) {
        if (loadError != null || (started && !engineBound)) return LOAD_FAILED;
        return running ? "running" : "stopped";
    }

    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: nothing to drive.
        if (ctx == null) return;
        SynthHost h = new SynthHost(ctx);
        core.components().watch(COMPONENT, h::bind);
        core.services().provide(OutputGate.class, h);
        core.notes().subscribe(h);
        host = h;
    }

    @Override public void stop() {
        SynthHost h = host;
        host = null;
        if (h == null) return;
        core.notes().unsubscribe(h);
        core.services().withdraw(OutputGate.class, h);
        h.stop();
    }
}
