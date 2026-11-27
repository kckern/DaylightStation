package net.kckern.daylight.cap.caractions.shell;

import net.kckern.daylight.cap.quickinput.shell.MemoFiles;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** The payload's answers on the "car" port, read for the car screen. Pure. */
final class CarAnswers {
    /** The rows a list shows: the payload's cap, held here too. */
    static final int MAX_ROWS = 6;
    /** A row's title is cut to this; an action's label is at most this long already. */
    static final int MAX_LABEL = 25;
    /** An entry the screen runs through the payload. */
    static final String RUN = "run";
    /** An entry that records a voice memo through the car's microphone. */
    static final String VOICE = "voice";
    /** A row that does nothing when tapped ("Daylight is starting"). */
    static final String NONE = "none";
    static final String STARTING = "Starting up…";
    static final String NO_ANSWER = "No answer from the phone. Try again.";

    static final class Entry {
        final String id;
        final String label;
        final String kind;
        /** A voice entry's destination id; null for any other entry, or one that is not an id. */
        final String dest;
        /** Why a voice entry cannot record now ("" when it can), as the payload says it. */
        final String why;

        Entry(String id, String label, String kind) { this(id, label, kind, null, ""); }

        Entry(String id, String label, String kind, String dest, String why) {
            this.id = id;
            this.label = label;
            this.kind = kind;
            this.dest = dest;
            this.why = why;
        }
    }

    private CarAnswers() { }

    /** The rows of a list answer, at most MAX_ROWS; a broken answer is no rows. */
    static List<Entry> entries(String answer) {
        List<Entry> out = new ArrayList<>();
        try {
            JSONArray entries = new JSONObject(answer).optJSONArray("entries");
            if (entries == null) return out;
            for (int i = 0; i < entries.length() && out.size() < MAX_ROWS; i++) {
                JSONObject e = entries.optJSONObject(i);
                if (e == null || e.optString("id", "").isEmpty()) continue;
                String label = e.optString("label", e.optString("id"));
                if (label.length() > MAX_LABEL) label = label.substring(0, MAX_LABEL);
                String kind = e.optString("kind", RUN);
                String dest = VOICE.equals(kind) ? MemoFiles.dest(e.optString("dest", "")) : null;
                String why = e.optString("why", "");
                if (why.length() > 80) why = why.substring(0, 80);
                out.add(new Entry(e.getString("id"), label, kind, dest, why));
            }
        } catch (Exception broken) {
            return new ArrayList<>();
        }
        return out;
    }

    /** What the list shows while no payload has attached. */
    static List<Entry> starting() {
        return Collections.singletonList(new Entry("", STARTING, NONE));
    }

    /** The message of a run answer. */
    static String message(String answer) {
        try {
            String m = new JSONObject(answer).optString("message", "");
            return m.isEmpty() ? NO_ANSWER : m;
        } catch (Exception broken) {
            return NO_ANSWER;
        }
    }
}
