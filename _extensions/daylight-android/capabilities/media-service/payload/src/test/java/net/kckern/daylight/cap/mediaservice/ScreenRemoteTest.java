package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import net.kckern.daylight.core.backend.Http;

import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class ScreenRemoteTest {
    private final List<String> calls = new ArrayList<>();
    private int status = 200;
    private String body = "{\"ok\":true}";

    private final Http http = new Http() {
        @Override public Reply get(String url) { calls.add("GET " + url); return new Reply(status, body); }
        @Override public Reply postJson(String url, String json) { calls.add("POST " + url + " " + json); return new Reply(status, body); }
        @Override public Reply putJson(String url, String json) { calls.add("PUT " + url + " " + json); return new Reply(status, body); }
        @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) {
            throw new AssertionError("no uploads");
        }
    };

    private final ScreenRemote remote = new ScreenRemote(http, path -> "https://home.example" + path, () -> "Phone", () -> "cmd-1");

    /** The same rule as the web fleet: content control or fleet: true. Only id and name leave. */
    @Test public void screensAreTheDevicesWithContentControlOrAFleetFlag() throws Exception {
        body = "{\"devices\":{"
                + "\"office-tv\":{\"name\":\"Office Screen\",\"type\":\"linux-pc\",\"content_control\":{\"provider\":\"x\"},\"host\":\"10.0.0.5\"},"
                + "\"garage-tv\":{\"fleet\":true},"
                + "\"phone\":{},"
                + "\"printer\":{\"name\":\"Printer\",\"type\":\"laser-printer\"},"
                + "\"Bad Id\":{\"fleet\":true}}}";
        JSONObject reply = remote.screens();
        assertEquals("GET https://home.example/api/v1/device/config", calls.get(0));
        assertEquals(2, reply.getJSONArray("items").length());
        Map<String, String> names = new java.util.HashMap<>();
        Map<String, String> types = new java.util.HashMap<>();
        for (int i = 0; i < 2; i++) {
            JSONObject item = reply.getJSONArray("items").getJSONObject(i);
            assertEquals(3, item.length());
            names.put(item.getString("id"), item.getString("name"));
            types.put(item.getString("id"), item.getString("type"));
        }
        assertEquals("Office Screen", names.get("office-tv"));
        assertEquals("garage-tv", names.get("garage-tv"));
        assertEquals("linux-pc", types.get("office-tv"));
        assertEquals("", types.get("garage-tv"));
        assertFalse("hosts never leave the payload", reply.toString().contains("10.0.0.5"));
    }

    @Test public void aPlayingScreenAnswersItsSnapshot() throws Exception {
        body = "{\"state\":\"playing\",\"position\":12}";
        JSONObject reply = remote.session("office-tv");
        assertEquals("GET https://home.example/api/v1/device/office-tv/session", calls.get(0));
        assertEquals(200, reply.getInt("status"));
        assertEquals("playing", reply.getJSONObject("snapshot").getString("state"));
    }

    @Test public void thumbnailsBecomeBackendUrlsAndForeignOnesAreDropped() throws Exception {
        body = "{\"state\":\"playing\",\"currentItem\":{\"thumbnail\":\"/api/v1/display/share:s1\"},"
                + "\"queue\":{\"items\":[{\"thumbnail\":\"https://evil.example/x.png\"},{\"thumbnail\":\"//evil.example/y\"}]}}";
        JSONObject snap = remote.session("office-tv").getJSONObject("snapshot");
        assertEquals("https://home.example/api/v1/display/share:s1", snap.getJSONObject("currentItem").getString("thumbnail"));
        assertFalse(snap.getJSONObject("queue").getJSONArray("items").getJSONObject(0).has("thumbnail"));
        assertFalse(snap.getJSONObject("queue").getJSONArray("items").getJSONObject(1).has("thumbnail"));
    }

    /** Off: the last snapshot it sent comes back as the snapshot, with when it was seen. */
    @Test public void anOffScreenAnswersItsLastKnownSnapshot() throws Exception {
        status = 503;
        body = "{\"offline\":true,\"lastKnown\":{\"state\":\"paused\"},\"lastSeenAt\":\"2026-11-25T20:00:00Z\"}";
        JSONObject reply = remote.session("office-tv");
        assertEquals(503, reply.getInt("status"));
        assertEquals("paused", reply.getJSONObject("snapshot").getString("state"));
        assertEquals("2026-11-25T20:00:00Z", reply.getString("lastSeenAt"));
    }

    @Test public void idleAndNeverSeenAreStatusesNotFailures() throws Exception {
        status = 204; body = "";
        assertFalse(remote.session("office-tv").has("snapshot"));
        status = 404; body = "{\"code\":\"DEVICE_NOT_FOUND\"}";
        assertEquals(404, remote.session("office-tv").getInt("status"));
    }

    @Test(expected = MediaApi.Refused.class)
    public void anyOtherStatusIsARefusal() throws Exception {
        status = 500;
        remote.session("office-tv");
    }

    @Test(expected = IllegalArgumentException.class)
    public void aDeviceIdIsNeverAPath() throws Exception {
        remote.session("../config");
    }

    @Test public void aSeekIsATransportCommandWithItsIdAndThisDevicesName() throws Exception {
        JSONObject reply = remote.command(new JSONObject().put("device", "office-tv").put("command", "transport")
                .put("action", "seekAbs").put("value", 42.5));
        String call = calls.get(0);
        assertTrue(call, call.startsWith("POST https://home.example/api/v1/device/office-tv/session/transport "));
        JSONObject sent = new JSONObject(call.substring(call.indexOf('{')));
        assertEquals("cmd-1", sent.getString("commandId"));
        assertEquals("seekAbs", sent.getString("action"));
        assertEquals(42.5, sent.getDouble("value"), 0);
        assertEquals("Phone", sent.getJSONObject("origin").getString("name"));
        assertTrue(reply.getBoolean("accepted"));
        assertEquals("cmd-1", reply.getString("commandId"));
    }

    @Test public void pauseSendsNoValue() throws Exception {
        remote.command(new JSONObject().put("device", "office-tv").put("command", "transport").put("action", "pause"));
        assertFalse(calls.get(0).contains("\"value\""));
    }

    @Test public void queueJumpAndRemoveNameTheEntryNotTheContent() throws Exception {
        remote.command(new JSONObject().put("device", "office-tv").put("command", "queue").put("op", "jump").put("queueItemId", "q7"));
        assertTrue(calls.get(0), calls.get(0).startsWith("POST https://home.example/api/v1/device/office-tv/session/queue/jump "));
        assertTrue(calls.get(0).contains("\"queueItemId\":\"q7\""));
        remote.command(new JSONObject().put("device", "office-tv").put("command", "queue").put("op", "clear"));
        assertTrue(calls.get(1).startsWith("POST https://home.example/api/v1/device/office-tv/session/queue/clear "));
    }

    @Test public void aReorderSendsTheNewOrderById() throws Exception {
        remote.command(new JSONObject().put("device", "office-tv").put("command", "queue").put("op", "reorder")
                .put("items", new org.json.JSONArray().put("q2").put("q1")));
        assertTrue(calls.get(0), calls.get(0).startsWith("POST https://home.example/api/v1/device/office-tv/session/queue/reorder "));
        assertTrue(calls.get(0).contains("\"items\":[\"q2\",\"q1\"]"));
    }

    @Test public void shuffleRepeatAndVolumeArePuts() throws Exception {
        remote.command(new JSONObject().put("device", "office-tv").put("command", "shuffle").put("enabled", true));
        remote.command(new JSONObject().put("device", "office-tv").put("command", "repeat").put("mode", "all"));
        remote.command(new JSONObject().put("device", "office-tv").put("command", "volume").put("level", 30));
        assertTrue(calls.get(0).startsWith("PUT https://home.example/api/v1/device/office-tv/session/shuffle "));
        assertTrue(calls.get(0).contains("\"enabled\":true"));
        assertTrue(calls.get(1).contains("/session/repeat ") && calls.get(1).contains("\"mode\":\"all\""));
        assertTrue(calls.get(2).contains("/session/volume ") && calls.get(2).contains("\"level\":30"));
    }

    /** The screen did not confirm: handed back with the backend's code, and not sent again. */
    @Test public void anUnconfirmedCommandIsReportedOnce() throws Exception {
        status = 502;
        body = "{\"ok\":false,\"error\":\"no ack\",\"code\":\"DEVICE_REFUSED\"}";
        JSONObject reply = remote.command(new JSONObject().put("device", "office-tv").put("command", "transport").put("action", "play"));
        assertFalse(reply.getBoolean("accepted"));
        assertEquals(502, reply.getInt("status"));
        assertEquals("DEVICE_REFUSED", reply.getString("code"));
        assertEquals(1, calls.size());
    }

    @Test public void unknownKindsActionsAndOpsAreRefusedBeforeSending() throws Exception {
        String[][] bad = {
                {"command", "system"}, {"command", "transport", "action", "goLive"},
                {"command", "queue", "op", "play-now"}, {"command", "repeat", "mode", "sometimes"},
        };
        for (String[] b : bad) {
            JSONObject r = new JSONObject().put("device", "office-tv");
            for (int i = 0; i < b.length; i += 2) r.put(b[i], b[i + 1]);
            try { remote.command(r); fail(r.toString()); } catch (IllegalArgumentException expected) { }
        }
        try { remote.command(new JSONObject().put("device", "office-tv").put("command", "volume").put("level", 101)); fail(); }
        catch (IllegalArgumentException expected) { }
        assertTrue(calls.isEmpty());
    }
}
