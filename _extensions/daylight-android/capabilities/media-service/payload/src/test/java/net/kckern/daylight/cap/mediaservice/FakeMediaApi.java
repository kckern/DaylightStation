package net.kckern.daylight.cap.mediaservice;

import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

final class FakeMediaApi implements MediaApi {
    final Map<String, String> responses = new HashMap<>();
    final List<String> calls = Collections.synchronizedList(new ArrayList<String>());
    final List<JSONObject> logged = Collections.synchronizedList(new ArrayList<JSONObject>());
    volatile boolean down;
    volatile int logStatus = 200;

    private JSONObject answer(String route, String call) throws Exception {
        calls.add(call);
        if (down) throw new IOException("no route to host");
        String body = responses.get(call);
        if (body == null) throw new Refused(route, 404);
        return new JSONObject(body);
    }

    @Override public JSONObject rootList() throws Exception { return answer("list", "rootList"); }
    @Override public JSONObject list(String contentId, int take, int skip) throws Exception { return answer("list", "list " + contentId + " " + take + " " + skip); }
    @Override public JSONObject recent(int limit) throws Exception { return answer("recent", "recent " + limit); }
    @Override public JSONObject audioSources() throws Exception { return answer("audio list sources", "audioSources"); }
    @Override public JSONObject audioLists(String source, int cursor) throws Exception {
        return answer("audio list catalog", "audioLists " + source + " " + cursor);
    }
    @Override public JSONObject queue(String contentId) throws Exception { return answer("queue", "queue " + contentId); }
    @Override public JSONObject play(String contentId, boolean resume) throws Exception {
        return answer("play", "play " + contentId + (resume ? "" : "?resume=false"));
    }
    @Override public JSONObject levels(String contentId, int samples) throws Exception {
        String call = "levels " + contentId + " " + samples;
        if ("none".equals(responses.get(call))) { calls.add(call); return null; }
        return answer("levels", call);
    }
    @Override public JSONObject lyrics(String contentId) throws Exception {
        String call = "lyrics " + contentId;
        if ("none".equals(responses.get(call))) { calls.add(call); return null; }
        return answer("lyrics", call);
    }
    @Override public JSONObject search(String text, int take) throws Exception { return answer("search", "search " + text + " " + take); }
    @Override public void log(JSONObject body) throws Exception {
        if (down) throw new IOException("no route to host");
        if (logStatus != 200) throw new Refused("play/log", logStatus);
        logged.add(body);
    }
}
