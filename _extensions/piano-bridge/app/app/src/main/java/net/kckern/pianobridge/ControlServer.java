package net.kckern.pianobridge;

import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.Collections;
import java.util.Set;
import java.util.Timer;
import java.util.TimerTask;
import java.util.concurrent.ConcurrentHashMap;

import fi.iki.elonen.NanoWSD;

/**
 * ControlServer — NanoWSD WebSocket control channel on port 8770.
 *
 * Protocol (MUST match frontend usePianoVoiceBridge.js / instrumentSpec.js):
 *
 *   INBOUND (browser -> APK), JSON text frames keyed by "type":
 *     engine.start                                       -> engine.start()
 *     engine.stop                                        -> engine.stop()
 *     preset.load  { spec: {id,name,engine,asset,patch,
 *                           gain_db,transpose,tune,
 *                           velocity_curve,reverb,eq,chorus} }
 *                                                        -> engine.loadPreset(...)
 *     param.set    { path, value }                       -> engine.setParam(path, value)
 *     panic                                              -> engine.panic()
 *     note.on      { note, velocity }   (RELAY fallback) -> engine.noteOn()
 *     note.off     { note }             (RELAY fallback) -> engine.noteOff()
 *
 *   OUTBOUND (APK -> browser), JSON text frames keyed by "type":
 *     ready                                              (on connect)
 *     status   { engine:"running"|"stopped", preset:<id|null>, cpu:<n>, xruns:<n> }
 *                                                        (~1s heartbeat)
 *     error    { code, msg }                             (on failure)
 *     note.on  { note, velocity }                        (live MIDI fan-out)
 *     note.off { note }                                  (live MIDI fan-out)
 *
 * The browser is the config authority: preset.load ships a fully-resolved spec.
 * note.on/off INBOUND is the relay fallback used when the APK cannot read the
 * BLE-MIDI piano directly; note.on/off OUTBOUND feeds the browser visualizers.
 */
public class ControlServer extends NanoWSD {

    private static final String TAG = "PianoBridge-WS";
    public static final int PORT = 8770;

    private final PianoBridgeService service;
    private final Set<ControlSocket> clients =
            Collections.newSetFromMap(new ConcurrentHashMap<ControlSocket, Boolean>());
    private final Timer heartbeatTimer = new Timer("PianoBridge-WS-heartbeat", true);

    /** Last loaded preset id, reported in the status heartbeat. */
    private volatile String currentPresetId = null;

    public ControlServer(PianoBridgeService service) {
        super(PORT);
        this.service = service;
    }

    @Override
    public void start(int timeout, boolean daemon) throws IOException {
        super.start(timeout, daemon);
        Log.i(TAG, "ControlServer listening on port " + PORT);
        heartbeatTimer.scheduleAtFixedRate(new TimerTask() {
            @Override public void run() { broadcastStatus(); }
        }, 1000L, 1000L);
    }

    @Override
    public void stop() {
        Log.i(TAG, "ControlServer stopping");
        heartbeatTimer.cancel();
        super.stop();
    }

    @Override
    protected WebSocket openWebSocket(IHTTPSession handshake) {
        Log.i(TAG, "Handshake from " + handshake.getRemoteIpAddress());
        return new ControlSocket(handshake);
    }

    // --- live MIDI fan-out (called by PianoBridgeService's MidiReceiver) ---

    /** Forward a live note-on from the BLE-MIDI piano to all connected clients. */
    public void fanOutNoteOn(int note, int velocity) {
        broadcast(buildNote("note.on", note, velocity));
    }

    /** Forward a live note-off from the BLE-MIDI piano to all connected clients. */
    public void fanOutNoteOff(int note) {
        broadcast(buildNote("note.off", note, -1));
    }

    private String buildNote(String type, int note, int velocity) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", type);
            o.put("note", note);
            if (velocity >= 0) o.put("velocity", velocity);
            return o.toString();
        } catch (JSONException e) {
            return null;
        }
    }

    private void broadcastStatus() {
        if (clients.isEmpty()) return;
        try {
            PianoEngine engine = service.getEngine();
            JSONObject o = new JSONObject();
            o.put("type", "status");
            o.put("engine", service.isEngineRunning() ? "running" : "stopped");
            o.put("preset", currentPresetId == null ? JSONObject.NULL : currentPresetId);
            o.put("cpu", engine != null ? engine.cpuLoad() : -1);
            o.put("xruns", engine != null ? engine.xruns() : -1);
            broadcast(o.toString());
        } catch (JSONException e) {
            Log.w(TAG, "status build failed", e);
        }
    }

    private void broadcast(String text) {
        if (text == null) return;
        for (ControlSocket c : clients) {
            try {
                c.send(text);
            } catch (IOException e) {
                Log.w(TAG, "broadcast send failed; dropping client", e);
                clients.remove(c);
            }
        }
    }

    /**
     * Resolve a spec asset path under the instruments dir, guarding against
     * path traversal and absolute paths. Returns the absolute file path, or
     * null if the asset is unsafe / outside the instruments root.
     */
    private String resolveAsset(String asset) {
        if (asset == null || asset.isEmpty()) return null;
        // Reject traversal / absolute / backslash up front (mirrors instrumentSpec.js SAFE()).
        if (asset.contains("..") || asset.startsWith("/") || asset.contains("\\")) {
            Log.e(TAG, "Rejected unsafe asset path: " + asset);
            return null;
        }
        File root = service.getInstrumentsDir();
        File target = new File(root, asset);
        try {
            String rootCanon = root.getCanonicalPath();
            String targetCanon = target.getCanonicalPath();
            // Belt-and-suspenders: canonical path must stay within the root.
            if (!targetCanon.equals(rootCanon) && !targetCanon.startsWith(rootCanon + File.separator)) {
                Log.e(TAG, "Asset escapes instruments root: " + targetCanon);
                return null;
            }
            return targetCanon;
        } catch (IOException e) {
            Log.e(TAG, "Asset canonicalization failed for " + asset, e);
            return null;
        }
    }

    /** One connected control client. */
    private class ControlSocket extends WebSocket {

        ControlSocket(IHTTPSession handshakeRequest) {
            super(handshakeRequest);
        }

        @Override
        protected void onOpen() {
            clients.add(this);
            Log.i(TAG, "Client connected (" + clients.size() + " total)");
            try {
                send(new JSONObject().put("type", "ready").toString());
            } catch (JSONException | IOException e) {
                Log.w(TAG, "failed to send ready", e);
            }
        }

        @Override
        protected void onClose(WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) {
            clients.remove(this);
            Log.i(TAG, "Client disconnected: code=" + code + " reason=" + reason
                    + " remote=" + initiatedByRemote + " (" + clients.size() + " left)");
        }

        @Override
        protected void onMessage(WebSocketFrame message) {
            String payload = message.getTextPayload();
            JSONObject msg;
            String type;
            try {
                msg = new JSONObject(payload);
                type = msg.optString("type", "");
            } catch (JSONException e) {
                Log.e(TAG, "Parse error on inbound frame: " + payload, e);
                sendError("bad_json", "could not parse frame");
                return;
            }

            Log.d(TAG, "inbound type=" + type);
            try {
                dispatch(type, msg);
            } catch (Exception e) {
                Log.e(TAG, "dispatch failed for type=" + type, e);
                sendError("dispatch_failed", e.getMessage());
            }
        }

        @Override
        protected void onPong(WebSocketFrame pong) {
            Log.d(TAG, "pong");
        }

        @Override
        protected void onException(IOException exception) {
            Log.e(TAG, "WebSocket exception", exception);
            clients.remove(this);
        }

        private void dispatch(String type, JSONObject msg) {
            PianoEngine engine = service.getEngine();
            switch (type) {
                case "engine.start":
                    service.engineStart();
                    break;
                case "engine.stop":
                    service.engineStop();
                    break;
                case "preset.load": {
                    JSONObject spec = msg.optJSONObject("spec");
                    if (spec == null) { sendError("no_spec", "preset.load missing spec"); break; }
                    handlePresetLoad(spec);
                    break;
                }
                case "param.set": {
                    String path = msg.optString("path", null);
                    if (path == null) { sendError("no_path", "param.set missing path"); break; }
                    float value = (float) msg.optDouble("value", 0.0);
                    if (engine != null) engine.setParam(path, value);
                    break;
                }
                case "panic":
                    if (engine != null) engine.panic();
                    break;
                case "note.on": {
                    // Relay fallback: browser forwards MIDI it read itself.
                    int note = msg.optInt("note", -1);
                    int vel = msg.optInt("velocity", 64);
                    if (note >= 0 && engine != null) engine.noteOn(note, vel);
                    break;
                }
                case "note.off": {
                    int note = msg.optInt("note", -1);
                    if (note >= 0 && engine != null) engine.noteOff(note);
                    break;
                }
                default:
                    Log.w(TAG, "Unknown inbound type: " + type);
                    sendError("unknown_type", "unhandled type: " + type);
            }
        }

        private void handlePresetLoad(JSONObject spec) {
            PianoEngine engine = service.getEngine();
            if (engine == null) { sendError("no_engine", "engine not initialized"); return; }

            String engineName = spec.optString("engine", "");
            String asset = spec.optString("asset", "");
            String resolved = resolveAsset(asset);
            if (resolved == null) {
                sendError("bad_asset", "asset path rejected: " + asset);
                return;
            }
            int patch = spec.optInt("patch", 0);
            float gainDb = (float) spec.optDouble("gain_db", 0.0);
            int transpose = spec.optInt("transpose", 0);
            int tune = spec.optInt("tune", 0);
            String velCurve = spec.optString("velocity_curve", "natural");
            // reverb may be null or an object with a "mix" field.
            float reverbMix = 0f;
            JSONObject reverb = spec.optJSONObject("reverb");
            if (reverb != null) reverbMix = (float) reverb.optDouble("mix", 0.0);

            boolean ok = engine.loadPreset(engineName, resolved, patch, gainDb,
                    transpose, tune, velCurve, reverbMix);
            if (ok) {
                currentPresetId = spec.optString("id", null);
                Log.i(TAG, "preset loaded id=" + currentPresetId + " engine=" + engineName);
            } else {
                sendError("preset_failed", "engine refused preset " + spec.optString("id", "?"));
            }
        }

        private void sendError(String code, String msgText) {
            try {
                JSONObject o = new JSONObject();
                o.put("type", "error");
                o.put("code", code);
                o.put("msg", msgText == null ? "" : msgText);
                send(o.toString());
                Log.w(TAG, "sent error code=" + code + " msg=" + msgText);
            } catch (JSONException | IOException e) {
                Log.e(TAG, "failed to send error frame", e);
            }
        }
    }
}
