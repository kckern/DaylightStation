package net.kckern.daylight.cap.midibridge;

import android.content.Context;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Diag;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.StatusBoard;
import net.kckern.daylight.core.spi.BluetoothRole;

import org.json.JSONArray;
import net.kckern.daylight.core.spi.PianoKioskTools;
import org.json.JSONObject;

public final class MidiBridgeCapability implements Capability {
    private static final String TAG = "PianoBridge-WS";

    private CoreContext core;
    private MidiConfig config;
    private volatile MidiLink link;
    private volatile boolean applying;

    @Override public String name() { return "midi-bridge"; }

    private BleMidiConnector ble() { MidiLink l = link; return l == null ? null : l.getBleConnector(); }
    private Loopback loopback() { MidiLink l = link; return l == null ? null : l.getLoopback(); }

    @Override public void register(CoreContext core) {
        this.core = core;
        core.services().provide(PianoKioskTools.MidiTap.class, () -> {
            MidiLink current = link;
            return current != null && config.bluetoothMidiEnabled() ? current.midiInTapSnapshot() : null;
        });
        MidiConfig.declare(core.settings());
        config = new MidiConfig(core.settings());
        core.settings().onChange(key -> {
            MidiLink l = link;
            if (!applying && l != null && key.startsWith("midi.") && !key.equals("midi.targetName")) l.reconnect();
        });
        core.services().provide(BluetoothRole.class, new MidiRole());
        // midi.enabled is the coexistence switch for the BLE-MIDI link: the connector reads
        // it at every scan and connect decision, and a change reconnects (above), so it is
        // applied the moment it changes. Off while piano-bridge still holds the link.
        net.kckern.daylight.core.LiveSwitch.report(core, "midi.enabled", () -> link != null && config.bluetoothMidiEnabled());

        core.services().provide(net.kckern.daylight.core.spi.PianoOutput.class, new net.kckern.daylight.core.spi.PianoOutput() {
            @Override public boolean send(byte[] bytes, long delay) {
                MidiLink l = link;
                return l != null && config.bluetoothMidiEnabled() && l.scheduleMidi(bytes, delay);
            }
            @Override public JSONObject repair() {
                MidiLink l = link;
                return l != null && config.bluetoothMidiEnabled() ? l.forceResetLink() : null;
            }
        });
        Router r = core.router();
        r.route("POST", "/connect", req -> {
            BleMidiConnector b = ble();
            if (b == null) return Replies.json(Replies.err("no_connector"));
            b.connectNow();
            return Replies.json(Replies.ok().put("action", "connect"));
        });
        r.route("POST", "/forget", req -> {
            BleMidiConnector b = ble();
            if (b == null) return Replies.json(Replies.err("no_connector"));
            b.forget();
            return Replies.json(Replies.ok().put("action", "forget"));
        });
        r.route("POST", "/scan", req -> {
            BleMidiConnector b = ble();
            if (b == null) return Replies.json(Replies.err("no_connector"));
            return Replies.json(Replies.ok().put("devices", b.scanForDevices(Replies.intParam(req, "ms", 4000))));
        });
        r.route("GET", "/midi/tap", req -> {
            MidiLink l = link;
            return Replies.json(l == null ? Replies.err("not_ready") : Replies.ok().put("tap", l.midiInTapSnapshot()));
        });
        Router.Handler send = this::midiSend;
        r.route("GET", "/midi/send", send);
        r.route("POST", "/midi/send", send);
        r.route("POST", "/reset", req -> {
            // Escalating reset of the BLE link, proven by the instrument's echo at each step.
            MidiLink l = link;
            if (l == null) return Replies.json(Replies.err("not_ready"));
            Diag.log(TAG, "/reset from " + req.remote);
            return Replies.json(l.forceResetLink());
        });
        r.route("GET", "/loopback", req -> {
            Loopback lb = loopback();
            return Replies.json(lb == null ? Replies.err("loopback not started") : Replies.ok().put("loopback", lb.snapshot()));
        });
        r.route("POST", "/loopback", req -> {
            Loopback lb = loopback();
            return Replies.json(lb == null ? Replies.err("loopback not started") : lb.probeAndWait());
        });
        r.route("POST", "/tone", this::tone);

        // Browser to instrument. The WebView is denied Web MIDI SysEx, so effects can only
        // reach the piano through here. Accepts {hex:"F0 …"} or {bytes:[240,65,…]}.
        core.socket().on("midi.raw", (msg, reply) -> {
            byte[] raw = null;
            String hex = msg.optString("hex", null);
            if (hex != null && !hex.isEmpty()) {
                try { raw = MidiWire.parseHexBytes(hex); }
                catch (IllegalArgumentException e) { reply.error("bad_hex", e.getMessage()); return; }
            } else {
                JSONArray arr = msg.optJSONArray("bytes");
                if (arr != null) {
                    raw = new byte[arr.length()];
                    for (int i = 0; i < arr.length(); i++) raw[i] = (byte) arr.optInt(i, 0);
                }
            }
            if (raw == null || raw.length == 0) { reply.error("no_bytes", "midi.raw needs hex or bytes"); return; }
            MidiLink l = link;
            int reps = Math.max(1, Math.min(10, msg.optInt("repeat", 1)));
            boolean okAll = l != null;
            for (int i = 0; l != null && i < reps; i++) {
                if (i > 0) { try { Thread.sleep(30L); } catch (InterruptedException ignored) { } }
                okAll &= l.sendMidi(raw);
            }
            if (!okAll) reply.error("write_failed", "MIDI write path not open");
        });

        StatusBoard board = core.status();
        board.add(StatusBoard.Surface.FRAME, name(), o -> {
            MidiLink l = link;
            o.put("midiInOpen", l != null && l.isMidiPortOpen());
            o.put("midiWriteOpen", l != null && l.isMidiWriteOpen());
            Loopback lb = loopback();
            if (lb != null) o.put("outVerified", lb.snapshot().optBoolean("outVerified"));
        });
        board.add(StatusBoard.Surface.STATUS, name(), o -> {
            MidiLink l = link;
            BleMidiConnector b = ble();
            o.put("ble", b != null ? b.status() : JSONObject.NULL);
            Loopback lb = loopback();
            if (lb != null) o.put("outVerified", lb.snapshot().optBoolean("outVerified"));
            // "BLE CONNECTED" says nothing about whether we can send.
            String werr = l == null ? null : l.getMidiWriteLastError();
            o.put("midiWrite", new JSONObject()
                    .put("open", l != null && l.isMidiWriteOpen())
                    .put("lastError", werr == null ? JSONObject.NULL : werr));
        });
        board.add(StatusBoard.Surface.HEARTBEAT, name(), o -> {
            MidiLink l = link;
            BleMidiConnector b = ble();
            JSONObject st = b == null ? null : b.status();
            String bleState = st == null ? "none" : st.optString("state", "?");
            o.put("ble", bleState);
            o.put("bleUptimeS", st == null ? 0 : st.optLong("connectedSeconds", 0));
            o.put("bleReconnects", st == null ? 0 : st.optInt("reconnects", 0));
            o.put("midiWriteOpen", l != null && l.isMidiWriteOpen());
            o.put("midiInOpen", l != null && l.isMidiPortOpen());
            boolean outVerified = false;
            Loopback lb = loopback();
            if (lb != null) {
                JSONObject s = lb.snapshot();
                outVerified = s.optBoolean("outVerified");
                o.put("outVerified", outVerified);
                o.put("loopRttMs", s.optLong("lastRttMs", -1));
                o.put("loopMisses", s.optInt("consecutiveMisses"));
            }
            o.put("linkVerdict", !"CONNECTED".equals(bleState) ? "DOWN" : (outVerified ? "VERIFIED" : "ZOMBIE"));
        });
        board.add(StatusBoard.Surface.DIAGNOSTICS, name(), o -> {
            MidiLink l = link;
            BleMidiConnector b = ble();
            o.put("midiIn", l != null ? l.midiInStatus() : JSONObject.NULL);
            o.put("ble", b != null ? b.status() : JSONObject.NULL);
        });
        // Probe right before each heartbeat so the beat carries a fresh delivery verdict.
        board.beforeHeartbeat(() -> { Loopback lb = loopback(); if (lb != null) lb.probeAndWait(); });
    }

    /** GET|POST /midi/send?hex=F0 41 … F7[&repeat=3][&inMs=120]. hex may also be the POST body. */
    private Router.Response midiSend(Router.Request req) throws Exception {
        String hex = Replies.strParam(req, "hex", null);
        if (hex == null) hex = Replies.strParam(req, "bytes", null);   // alias
        if (hex == null && req.body != null) hex = req.body;
        if (hex == null || hex.trim().isEmpty()) return Replies.json(Replies.err("missing hex"));
        byte[] bytes;
        try { bytes = MidiWire.parseHexBytes(hex); }
        catch (IllegalArgumentException e) { return Replies.json(Replies.err(e.getMessage())); }
        if (bytes.length == 0) return Replies.json(Replies.err("no bytes"));
        MidiLink l = link;
        if (l == null) return Replies.json(Replies.err("not_ready"));
        // The instrument has no read-back and the MIDI router can drop a SysEx, so repeats
        // are the documented mitigation, spaced by more than one BLE connection interval.
        int repeat = Math.max(1, Math.min(10, Replies.intParam(req, "repeat", 1)));
        // inMs: send this many ms from now on the bridge's own clock. The page schedules
        // ahead and the bridge's timer fires on time however busy the WebView is.
        long inMs = Math.max(0, Math.min(30_000, Replies.intParam(req, "inMs", 0)));
        int sent = 0;
        if (inMs > 0) {
            if (l.scheduleMidi(bytes, inMs)) sent = repeat = 1;
        } else {
            for (int i = 0; i < repeat; i++) {
                if (i > 0) { try { Thread.sleep(30L); } catch (InterruptedException ignored) { } }
                if (l.sendMidi(bytes)) sent++;
            }
            Diag.log(TAG, "/midi/send " + req.remote + " bytes=" + bytes.length + " repeat=" + repeat + " sent=" + sent);
        }
        JSONObject o = Replies.ok();
        if (inMs > 0) o.put("inMs", inMs);
        o.put("bytes", bytes.length);
        o.put("repeat", repeat);
        o.put("sent", sent);
        o.put("writeOpen", l.isMidiWriteOpen());
        // Not a delivery claim: send() is fire-and-forget.
        o.put("note", "handed to the port; confirm delivery via JamCorder ble.in");
        return Replies.json(o);
    }

    /** POST /tone[?note=60][&velocity=127][&ms=700]: volume up, one note, then an echo probe. */
    private Router.Response tone(Router.Request req) throws Exception {
        MidiLink l = link;
        if (l == null) return Replies.json(Replies.err("not_ready"));
        int note = Math.max(0, Math.min(127, Replies.intParam(req, "note", 60)));
        int vel = Math.max(1, Math.min(127, Replies.intParam(req, "velocity", 127)));
        int ms = Math.max(50, Math.min(5000, Replies.intParam(req, "ms", 700)));
        boolean vOk = l.sendMidi(new byte[] { (byte) 0xB0, 0x07, 0x7F });
        if (!vOk) {
            // No write port: nothing to play and nothing to verify.
            Diag.log(TAG, "/tone " + req.remote + " refused: write port closed");
            return Replies.json(Replies.err(Loopback.REASON_WRITE_PORT_CLOSED)
                    .put("note", note).put("velocity", vel).put("ms", ms).put("sent", false).put("echoed", false));
        }
        boolean onOk = l.sendMidi(new byte[] { (byte) 0x90, (byte) note, (byte) vel });
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { }
        boolean offOk = l.sendMidi(new byte[] { (byte) 0x80, (byte) note, 0 });
        Diag.log(TAG, "/tone " + req.remote + " note=" + note + " vel=" + vel + " ms=" + ms + " sent=" + (vOk && onOk && offOk));
        JSONObject o = Replies.ok().put("note", note).put("velocity", vel).put("ms", ms).put("sent", vOk && onOk && offOk);
        Loopback lb = l.getLoopback();
        if (lb != null) {
            JSONObject probe = lb.probeAndWait();
            o.put("delivery", probe.optBoolean("echoed")
                    ? "VERIFIED - piano echoed a follow-up probe in " + probe.optLong("rttMs") + "ms"
                    : "UNVERIFIED - no echo; the tone may not have reached the piano");
            o.put("echoed", probe.optBoolean("echoed"));
        }
        o.put("audibility", "delivery is proven by the echo; SOUND still depends on the piano's own volume/headphones");
        return Replies.json(o);
    }

    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: there is no MIDI service to ask.
        if (ctx == null) return;
        MidiLink l = new MidiLink(ctx, config, core.notes(), core.socket());
        l.start();
        link = l;
    }

    /** Test seam: a link with no Android behind it. */
    void useLinkForTest(MidiLink l) { link = l; }

    @Override public void stop() {
        MidiLink l = link;
        link = null;
        if (l != null) l.stop();
    }

    /** The instrument link, as bluetooth-controls sees it. */
    private final class MidiRole implements BluetoothRole {
        @Override public String profile() { return "midi"; }
        @Override public String address() { return config.targetMac(); }
        @Override public String name() { return config.targetName(); }
        @Override public boolean enabled() { return config.bluetoothMidiEnabled(); }
        @Override public boolean present() { return ble() != null; }
        @Override public String connectedAddress() {
            BleMidiConnector b = ble();
            JSONObject st = b == null ? null : b.status();
            return st != null && "CONNECTED".equals(st.optString("state")) ? st.optString("connectedMac", "") : "";
        }
        @Override public boolean connectedTo(String address) {
            String now = connectedAddress();
            return !now.isEmpty() && now.equalsIgnoreCase(address);
        }
        @Override public void nudge() { BleMidiConnector b = ble(); if (b != null) b.connectNow(); }
        @Override public void assign(String address, String name) {
            applying = true;
            try {
                // One write: a failure leaves the old instrument assigned, not half of a new one.
                java.util.Map<String, Object> values = new java.util.LinkedHashMap<>();
                values.put("midi.targetMac", address);
                values.put("midi.targetName", name);
                values.put("midi.enabled", true);
                core.settings().setAll(values);
            } finally { applying = false; }
            MidiLink l = link;
            if (l != null) l.reconnect();
        }
        @Override public void rename(String name) { core.settings().set("midi.targetName", name); }
        @Override public void disable() { core.settings().set("midi.enabled", false); }
        @Override public boolean pauseDiscovery() { BleMidiConnector b = ble(); return b == null || b.pauseDiscoveryForPairing(); }
        @Override public void resumeDiscovery() { BleMidiConnector b = ble(); if (b != null) b.resumeDiscoveryAfterPairing(); }
    }
}
