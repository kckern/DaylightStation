package net.kckern.daylight.cap.webviewhost;

import net.kckern.daylight.core.spi.NoteListener;
import net.kckern.daylight.core.spi.PianoOutput;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The UI wake-up carries no data. Only the subscribing document can drain its queue. */
final class PianoPage implements NoteListener {
    final String token;
    private final Runnable wake;
    private JSONArray frames = new JSONArray();

    PianoPage(String token, Runnable wake) { this.token = token; this.wake = wake; }

    private synchronized void offer(JSONObject frame) throws JSONException {
        boolean notify = frames.length() == 0;
        if (frames.length() >= 512) frames = new JSONArray().put(new JSONObject().put("type", "reset"));
        frames.put(frame);
        if (notify) wake.run();
    }

    synchronized String drain() {
        String json = frames.toString();
        frames = new JSONArray();
        return json;
    }

    @Override public void noteOn(int note, int velocity, long t, int channel) {
        try {
            JSONObject frame = new JSONObject().put("type", "note.on").put("note", note)
                    .put("velocity", velocity).put("t", t);
            if (channel >= 0) frame.put("ch", channel);
            offer(frame);
        } catch (JSONException ignored) { }
    }

    @Override public void inputReset() {
        try { offer(new JSONObject().put("type", "reset")); }
        catch (JSONException ignored) { }
    }

    @Override public void noteOff(int note, long t) {
        try { offer(new JSONObject().put("type", "note.off").put("note", note).put("t", t)); }
        catch (JSONException ignored) { }
    }

    @Override public void controlChange(int controller, int value, int channel) {
        try {
            JSONObject frame = new JSONObject().put("type", "control.change").put("controller", controller).put("value", value);
            if (channel >= 0) frame.put("ch", channel);
            offer(frame);
        }
        catch (JSONException ignored) { }
    }

    static boolean send(PianoOutput out, String arg) throws JSONException {
        JSONObject request = new JSONObject(arg);
        JSONArray data = request.getJSONArray("bytes");
        Object inMs = request.get("inMs");
        if (!(inMs instanceof Integer)) return false;
        int delay = (Integer) inMs;
        if (data.length() == 0 || data.length() > 65536 || delay < 0 || delay > 30000) return false;
        byte[] bytes = new byte[data.length()];
        for (int i = 0; i < data.length(); i++) {
            Object value = data.get(i);
            if (!(value instanceof Integer)) return false;
            int b = (Integer) value;
            if (b < 0 || b > 255) return false;
            bytes[i] = (byte) b;
        }
        return out.send(bytes, delay);
    }
}
