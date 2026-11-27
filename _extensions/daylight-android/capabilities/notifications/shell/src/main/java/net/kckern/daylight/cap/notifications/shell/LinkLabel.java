package net.kckern.daylight.cap.notifications.shell;

import java.util.Locale;

/**
 * A few plain words for what a link does, for the "Starting Daylight… · <what>" card the
 * link activity shows while a cold start runs, so the owner sees their tap was kept and
 * does not tap again. Pure. Only the link's shape is read; the payload still decides
 * whether the link is allowed.
 */
final class LinkLabel {
    private LinkLabel() { }

    static String of(String link) {
        if (link == null) return "your tap";
        String lower = link.toLowerCase(Locale.ROOT);
        if (lower.startsWith("http://") || lower.startsWith("https://")) return "opening the link";
        if (!lower.startsWith("daylight://")) return "your tap";
        String rest = link.substring("daylight://".length());
        int q = rest.indexOf('?');
        if (q >= 0) rest = rest.substring(0, q);
        String[] parts = rest.split("/");
        String kind = parts.length > 0 ? parts[0].toLowerCase(Locale.ROOT) : "";
        String name = parts.length > 1 ? words(parts[1]) : "";
        switch (kind) {
            case "action": return name.isEmpty() ? "your shortcut" : name;
            case "bookmark": return name.isEmpty() ? "opening a page" : "opening " + name;
            case "media": return "starting your music";
            case "memo": return "voice memo";
            case "input":
                switch (parts.length > 1 ? parts[1].toLowerCase(Locale.ROOT) : "") {
                    case "voice": return "voice memo";
                    case "photo": return "photo";
                    case "text": return "text note";
                    default: return "your capture";
                }
            case "open": return "opening Daylight";
            default: return "your tap";
        }
    }

    /** "lights-off" → "Lights off". At most 40 characters. */
    static String words(String slug) {
        String s = slug == null ? "" : slug.replace('-', ' ').replace('_', ' ').trim();
        try { s = java.net.URLDecoder.decode(s, "UTF-8"); } catch (Exception keep) { }
        if (s.isEmpty()) return "";
        if (s.length() > 40) s = s.substring(0, 40).trim();
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
