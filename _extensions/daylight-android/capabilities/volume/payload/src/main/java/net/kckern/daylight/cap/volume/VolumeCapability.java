package net.kckern.daylight.cap.volume;

import android.content.Context;
import android.media.AudioManager;

import net.kckern.daylight.core.Capability;
import net.kckern.daylight.core.CoreContext;
import net.kckern.daylight.core.Replies;
import net.kckern.daylight.core.Requests;
import net.kckern.daylight.core.Router;
import net.kckern.daylight.core.UnsupportedException;
import net.kckern.daylight.core.spi.VolumeControl;

import org.json.JSONObject;

import java.util.Iterator;

/** GET and POST /volume, and the reads the page makes through the bridge. */
public final class VolumeCapability implements Capability, VolumeControl {
    /** A device's audio streams. The real one is AudioManager; a JVM test gives its own. */
    interface Streams {
        int max(int stream);
        int get(int stream);
        void set(int stream, int index);
    }

    private volatile Streams streams;
    void useStreamsForTest(Streams s) { streams = s; }

    @Override public String name() { return "volume"; }

    private CoreContext core;

    @Override public void register(CoreContext core) {
        this.core = core;
        core.services().provide(VolumeControl.class, this);
        core.router().route("GET", "/volume", req -> {
            int stream = VolumeMath.stream(req.query.get("stream"));
            return Router.Response.json(200, merge(Replies.ok(), readOrThrow(stream)));
        });
        core.router().route("POST", "/volume", req -> {
            JSONObject body = Requests.body(req);
            if (!(body.opt("level") instanceof Integer)) throw new IllegalArgumentException("body needs 'level': 0..100");
            int level = body.getInt("level");
            if (level < 0 || level > 100) throw new IllegalArgumentException("level must be 0..100");
            int stream = VolumeMath.stream(body.opt("stream"));
            Streams s = required();
            try {
                s.set(stream, VolumeMath.indexFor(level, s.max(stream)));
            } catch (SecurityException refused) {
                // Do-not-disturb can refuse a change. The read-back below reports what is true.
            }
            JSONObject result = readOrThrow(stream);
            boolean applied = result.getInt("index") == VolumeMath.indexFor(level, result.getInt("maxIndex"));
            // ok only when the index read back is the one asked for. Something else may hold the
            // stream (do-not-disturb, or audio-guard pinning the tablet's own speaker).
            return Router.Response.json(200, merge(applied ? Replies.ok() : Replies.err("volume_unchanged"), result));
        });
    }

    private static JSONObject merge(JSONObject into, JSONObject from) throws Exception {
        for (Iterator<String> it = from.keys(); it.hasNext(); ) { String k = it.next(); into.put(k, from.get(k)); }
        return into;
    }

    @Override public void start() {
        Context ctx = (Context) core.shell().context();
        // JVM tests boot every capability with no Android context: there is no audio service.
        if (ctx == null) return;
        final AudioManager audio = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        if (audio == null) return;       // the routes then answer 501 with the reason
        streams = new Streams() {
            @Override public int max(int stream) { return audio.getStreamMaxVolume(stream); }
            @Override public int get(int stream) { return audio.getStreamVolume(stream); }
            @Override public void set(int stream, int index) { audio.setStreamVolume(stream, index, 0); }
        };
    }

    @Override public void stop() { streams = null; }

    private Streams required() {
        Streams s = streams;
        if (s == null) throw new UnsupportedException("no audio service on this device");
        return s;
    }

    private JSONObject readOrThrow(int stream) throws Exception {
        Streams s = required();
        int max = s.max(stream), index = s.get(stream);
        return new JSONObject().put("stream", stream).put("level", VolumeMath.levelFor(index, max))
                .put("index", index).put("maxIndex", max);
    }

    // ── VolumeControl ─────────────────────────────────────────────────────────

    /** For the page bridge: an empty object when the stream cannot be read, never an exception. */
    @Override public JSONObject read(int stream) {
        try { return readOrThrow(stream); } catch (Throwable t) { return new JSONObject(); }
    }

    @Override public JSONObject set(int stream, int level) {
        Streams s = streams;
        if (s == null) return new JSONObject();
        try {
            s.set(stream, VolumeMath.indexFor(level, s.max(stream)));
        } catch (SecurityException refused) {
            // The read-back reports what is true.
        } catch (Throwable t) {
            return new JSONObject();
        }
        return read(stream);
    }
}
