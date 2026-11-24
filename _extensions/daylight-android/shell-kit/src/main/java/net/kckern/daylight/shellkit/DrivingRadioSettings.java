package net.kckern.daylight.shellkit;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/** Device-local rules shared by phone setup and the native media session. */
public final class DrivingRadioSettings {
    public static final String MEDIA_ID = "driving-radio";
    public static final String PLAYLIST_PREFS = "daylight_buttons";
    public static final String STAGED = "staged_playlist.";
    public static final String SHUFFLE = "playlist_shuffle.";
    private static final String STAPLE = "drive_staple.";
    private static final String ART = "staged_art.";
    /** The one last-played item, kept so the system can offer to resume it. */
    private static final String LAST_ID = "resume.id";
    private static final String LAST_TITLE = "resume.title";
    private static final String LAST_SUBTITLE = "resume.subtitle";
    private static final String LAST_ART = "resume.art";
    private static final String RADIO = "driving_radio.";
    public static final int DEFAULT = 0;
    private final SharedPreferences prefs;

    public DrivingRadioSettings(Context context) {
        prefs = context.getSharedPreferences(PLAYLIST_PREFS, Context.MODE_PRIVATE);
    }

    public static final class Staple {
        public final String id;
        public final String title;
        /** An https thumbnail, or "" when none was captured yet. */
        public final String art;

        Staple(String id, String title, String art) {
            this.id = id;
            this.title = title;
            this.art = art;
        }
    }

    public List<Staple> staged() {
        List<Staple> items = new ArrayList<>();
        prefs.getAll().forEach((key, value) -> {
            if (key.startsWith(STAGED) && value instanceof String) {
                String id = key.substring(STAGED.length());
                items.add(new Staple(id, (String) value, prefs.getString(ART + id, "")));
            }
        });
        items.sort(java.util.Comparator.comparing((Staple item) -> item.title,
                String.CASE_INSENSITIVE_ORDER).thenComparing(item -> item.id));
        return items;
    }

    public boolean isStaple(String id) {
        return isStaged(id) && prefs.getBoolean(STAPLE + id, false);
    }

    public void setStaple(String id, boolean selected) {
        if (isStaged(id)) prefs.edit().putBoolean(STAPLE + id, selected).apply();
    }

    public static boolean affectsDrive(String key) {
        return key == null || key.startsWith(STAPLE) || key.startsWith(STAGED) || key.startsWith(RADIO)
                || key.startsWith(ART);
    }

    /** Remember a playlist's thumbnail for the Drive grid. Only an https address is kept. */
    public void setArt(String id, String url) {
        if (!isStaged(id) || url == null || !url.startsWith("https://") || url.length() > 600) return;
        if (!url.equals(prefs.getString(ART + id, ""))) prefs.edit().putString(ART + id, url).apply();
    }

    public String art(String id) {
        return prefs.getString(ART + id, "");
    }

    public void clearArt(String id) {
        prefs.edit().remove(ART + id).apply();
    }

    public void rememberLast(String id, String title, String subtitle, String art) {
        if (id == null || id.isEmpty()) return;
        prefs.edit().putString(LAST_ID, id).putString(LAST_TITLE, title == null ? "" : title)
                .putString(LAST_SUBTITLE, subtitle == null ? "" : subtitle)
                .putString(LAST_ART, art == null ? "" : art).apply();
    }

    /** {id, title, subtitle, art}, or null when nothing has played. */
    public String[] last() {
        String id = prefs.getString(LAST_ID, "");
        if (id.isEmpty()) return null;
        return new String[]{id, prefs.getString(LAST_TITLE, ""), prefs.getString(LAST_SUBTITLE, ""),
                prefs.getString(LAST_ART, "")};
    }

    public boolean isStaged(String id) {
        return !id.isEmpty() && prefs.contains(STAGED + id);
    }

    public String get(int day) {
        String id = prefs.getString(RADIO + day, "");
        return isStaged(id) ? id : "";
    }

    public void set(int day, String playlist) {
        if (playlist.isEmpty() || prefs.contains(STAGED + playlist)) {
            prefs.edit().putString(RADIO + day, playlist).apply();
        }
    }

    public List<String> today() {
        return priority(get(Calendar.getInstance().get(Calendar.DAY_OF_WEEK)), get(DEFAULT));
    }

    public boolean shuffle(String playlist) {
        return prefs.getBoolean(SHUFFLE + playlist, true);
    }

    public static List<String> priority(String today, String fallback) {
        List<String> choices = new ArrayList<>(2);
        if (!today.isEmpty()) choices.add(today);
        if (!fallback.isEmpty() && !fallback.equals(today)) choices.add(fallback);
        return choices;
    }
}
