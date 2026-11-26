package net.kckern.daylight.core.backend;

import net.kckern.daylight.api.PayloadPort;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The payload end of the phone's telemetry: the installed UiTelemetry keeps every event
 * on disk and hands a batch to this port, which posts it to the backend's
 * {@code POST /api/v1/client-log} and answers {ok:true} only when the backend accepted
 * it (2xx). Anything else ({ok:false}: no network, the backend down or too old, no
 * backend configured) leaves the batch on the phone to be sent again later. Holds
 * nothing itself.
 */
public final class TelemetryRelay {
    public static final String PORT = "telemetry";
    static final int MAX_EVENTS = 200;

    private final PayloadPort port = PayloadPort.named(PORT);
    private final Backend backend;
    private final Http http;
    private final PayloadPort.Handler onCall = this::handle;

    public TelemetryRelay(Backend backend, Http http) {
        this.backend = backend;
        this.http = http;
    }

    public void attach() { port.attach(onCall); }

    public void detach() { port.detach(onCall); }

    String handle(String request) throws Exception {
        JSONObject in = new JSONObject(request);
        JSONArray events = in.optJSONArray("events");
        if (events == null || events.length() == 0) return new JSONObject().put("ok", true).put("accepted", 0).toString();
        if (events.length() > MAX_EVENTS) return new JSONObject().put("ok", false).put("status", 413).toString();
        String url;
        try {
            url = backend.url("/api/v1/client-log");
        } catch (RuntimeException notConfigured) {
            return new JSONObject().put("ok", false).put("status", 503).toString();
        }
        try {
            Http.Reply r = http.postJson(url, new JSONObject().put("source", "android").put("events", events).toString());
            JSONObject out = new JSONObject().put("ok", r.ok()).put("status", r.status);
            if (r.ok()) {
                try { out.put("accepted", new JSONObject(r.body).optInt("accepted", events.length())); }
                catch (Exception notJson) { out.put("accepted", events.length()); }
            }
            return out.toString();
        } catch (java.io.IOException offline) {
            return new JSONObject().put("ok", false).put("status", 0).toString();
        }
    }
}
