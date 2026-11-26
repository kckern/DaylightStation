package net.kckern.daylight.core.backend;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import net.kckern.daylight.core.SettingsRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class TelemetryRelayTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private final List<String> posts = new ArrayList<>();
    private int status = 202;
    private boolean offline;
    private TelemetryRelay relay;

    @Before public void setUp() throws Exception {
        SettingsRegistry settings = new SettingsRegistry(new File(tmp.newFolder(), "overrides.json"));
        Backend backend = Backend.from(settings, "phone");
        settings.set(Backend.BASE_URL, "https://kiosk.example");
        relay = new TelemetryRelay(backend, new Http() {
            @Override public Reply get(String url) { throw new AssertionError("telemetry is a POST"); }
            @Override public Reply postJson(String url, String json) throws IOException {
                if (offline) throw new IOException("no route to host");
                posts.add(url + " " + json);
                return new Reply(status, "{\"accepted\":2,\"dropped\":0}");
            }
            @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) {
                throw new AssertionError();
            }
        });
    }

    private static String batch(int n) throws Exception {
        JSONArray events = new JSONArray();
        for (int i = 0; i < n; i++) events.put(new JSONObject().put("id", "e" + i).put("event", "ui.tap"));
        return new JSONObject().put("source", "android").put("events", events).toString();
    }

    @Test public void anAcceptedBatchIsOk() throws Exception {
        JSONObject r = new JSONObject(relay.handle(batch(2)));
        assertTrue(r.getBoolean("ok"));
        assertEquals(2, r.getInt("accepted"));
        assertTrue(posts.get(0).startsWith("https://kiosk.example/api/v1/client-log {"));
        assertTrue(posts.get(0).contains("\"source\":\"android\""));
    }

    @Test public void offlineOrRefusedKeepsTheBatchOnThePhone() throws Exception {
        offline = true;
        assertFalse(new JSONObject(relay.handle(batch(2))).getBoolean("ok"));
        offline = false;
        status = 404; // a backend without the route
        assertFalse(new JSONObject(relay.handle(batch(2))).getBoolean("ok"));
        status = 500;
        assertFalse(new JSONObject(relay.handle(batch(2))).getBoolean("ok"));
    }

    @Test public void tooBigABatchIsRefusedUnsent() throws Exception {
        assertFalse(new JSONObject(relay.handle(batch(TelemetryRelay.MAX_EVENTS + 1))).getBoolean("ok"));
        assertTrue(posts.isEmpty());
        assertTrue(new JSONObject(relay.handle(batch(0))).getBoolean("ok"));
    }
}
