package net.kckern.daylight.cap.mediaservice.shell;

import android.os.Bundle;

import androidx.media3.common.MediaItem;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;

/**
 * The queue's saved copy (spec §7): every region, the source's label and order, shuffle,
 * repeat and the place, as small JSON in the app's files. Written on every change; read
 * once when the media service starts. The item codec is separate so the format is tested
 * without Android (QueueStateTest).
 */
final class QueueState {
    static final int VERSION = 1;

    interface Codec<T> {
        JSONObject write(T item) throws Exception;
        T read(JSONObject o);
    }

    private QueueState() { }

    static <T> JSONObject encode(QueueModel<T> model, long positionMs, Codec<T> codec) throws Exception {
        JSONObject o = new JSONObject();
        o.put("v", VERSION);
        o.put("now", model.nowIndex());
        o.put("pos", Math.max(0, positionMs));
        o.put("label", model.label());
        o.put("sourceId", model.sourceId());
        o.put("long", model.sourceLong());
        o.put("shuffled", model.shuffled());
        o.put("repeat", model.repeat().name());
        JSONArray entries = new JSONArray();
        for (int i = 0; i < model.size(); i++) {
            QueueModel.Entry<T> e = model.at(i);
            JSONObject j = new JSONObject();
            j.put("u", e.uid);
            j.put("t", codec.write(e.item));
            j.put("r", e.region.name());
            j.put("w", e.was.name());
            if (e.next) j.put("n", true);
            if (e.order >= 0) j.put("o", e.order);
            if (e.group != 0) { j.put("g", e.group); j.put("gl", e.groupLabel); }
            entries.put(j);
        }
        o.put("entries", entries);
        // The whole source in its order, for another pass (Repeat) after a restart.
        JSONArray all = new JSONArray();
        for (T t : model.sourceAll()) all.put(codec.write(t));
        o.put("all", all);
        return o;
    }

    /** Puts a saved queue into the model (which tells the player). Returns how many items came back. */
    static <T> int apply(QueueModel<T> model, JSONObject o, Codec<T> codec) {
        if (o == null || o.optInt("v") != VERSION) return 0;
        JSONArray entries = o.optJSONArray("entries");
        if (entries == null || entries.length() == 0) return 0;
        List<QueueModel.Entry<T>> list = new ArrayList<>();
        int now = o.optInt("now", 0), nowShift = 0;
        for (int i = 0; i < entries.length(); i++) {
            JSONObject j = entries.optJSONObject(i);
            T item = j == null ? null : codec.read(j.optJSONObject("t"));
            if (item == null) { if (i < now) nowShift++; continue; }
            list.add(model.savedEntry(j.optLong("u"), item, region(j.optString("r"), QueueModel.Region.SOURCE),
                    region(j.optString("w"), QueueModel.Region.SOURCE), j.optBoolean("n"), j.optInt("o", -1),
                    j.optLong("g", 0), j.optString("gl", "")));
        }
        if (list.isEmpty()) return 0;
        now = Math.max(0, Math.min(now - nowShift, list.size() - 1));
        // Every row before now is history; now is NOW (a damaged save cannot break the layout).
        for (int i = 0; i < list.size(); i++) {
            QueueModel.Entry<T> e = list.get(i);
            if (i < now) e.region = QueueModel.Region.HISTORY;
            else if (i == now) e.region = QueueModel.Region.NOW;
            else if (e.region == QueueModel.Region.HISTORY || e.region == QueueModel.Region.NOW) e.region = QueueModel.Region.SOURCE;
        }
        List<T> all = new ArrayList<>();
        JSONArray a = o.optJSONArray("all");
        for (int i = 0; a != null && i < a.length(); i++) {
            T t = codec.read(a.optJSONObject(i));
            if (t != null) all.add(t);
        }
        QueueModel.Repeat repeat;
        try { repeat = QueueModel.Repeat.valueOf(o.optString("repeat", "OFF")); } catch (IllegalArgumentException bad) { repeat = QueueModel.Repeat.OFF; }
        model.restore(list, now, o.optLong("pos", 0), o.optString("label", ""), o.optString("sourceId", ""),
                o.optBoolean("long"), o.optBoolean("shuffled"), repeat, all);
        return list.size();
    }

    private static QueueModel.Region region(String name, QueueModel.Region fallback) {
        try { return QueueModel.Region.valueOf(name); } catch (Exception bad) { return fallback; }
    }

    // ── the service's MediaItem form ───────────────────────────────────────

    static JSONObject encode(QueueModel<MediaItem> model, long positionMs) throws Exception {
        return encode(model, positionMs, ITEMS);
    }

    static int apply(QueueModel<MediaItem> model, JSONObject o) { return apply(model, o, ITEMS); }

    /** A track as NodeItems.tracks builds it: id, stream, words, cover, list, length, long form. */
    static final Codec<MediaItem> ITEMS = new Codec<MediaItem>() {
        @Override public JSONObject write(MediaItem m) throws Exception {
            JSONObject t = new JSONObject();
            t.put("id", m.mediaId);
            t.put("url", m.localConfiguration == null ? "" : String.valueOf(m.localConfiguration.uri));
            t.put("title", str(m.mediaMetadata.title));
            t.put("artist", str(m.mediaMetadata.artist));
            t.put("album", str(m.mediaMetadata.albumTitle));
            t.put("art", m.mediaMetadata.artworkUri == null ? "" : m.mediaMetadata.artworkUri.toString());
            Bundle x = m.mediaMetadata.extras;
            t.put("listId", NodeItems.listId(m));
            long d = x == null ? 0 : x.getLong("durationMs", 0);
            if (d > 0) t.put("dur", d);
            if (NodeItems.longFormKind(m)) t.put("lf", true);
            return t;
        }

        @Override public MediaItem read(JSONObject t) {
            if (t == null) return null;
            String id = t.optString("id"), url = t.optString("url");
            if (id.isEmpty() || !(url.startsWith("https://") || url.startsWith("http://"))) return null;
            TrackAnswer.Track track = new TrackAnswer.Track(id, url, t.optString("title"), t.optString("artist"),
                    t.optString("album"), t.optString("art").startsWith("https://") ? t.optString("art") : null,
                    t.optString("listId"), t.optLong("dur", 0));
            track.longForm = t.optBoolean("lf");
            List<TrackAnswer.Track> one = new ArrayList<>();
            one.add(track);
            return NodeItems.tracks(one).get(0);
        }
    };

    private static String str(CharSequence s) { return s == null ? "" : s.toString(); }

    static void write(File file, String json) {
        try {
            File dir = file.getParentFile();
            if (dir != null && !dir.isDirectory() && !dir.mkdirs()) return;
            File tmp = new File(file.getPath() + ".tmp");
            Files.write(tmp.toPath(), json.getBytes(StandardCharsets.UTF_8));
            Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (Exception failed) {
            android.util.Log.w("Daylight-Queue", "save failed: " + failed.getClass().getSimpleName());
        }
    }

    static JSONObject read(File file) {
        if (file == null || !file.isFile()) return null;
        try { return new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8)); }
        catch (Exception unreadable) { return null; }
    }
}
