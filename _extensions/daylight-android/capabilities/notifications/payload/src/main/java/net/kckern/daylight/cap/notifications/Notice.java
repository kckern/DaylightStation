package net.kckern.daylight.cap.notifications;

import net.kckern.daylight.core.spi.LocalNotices;

import java.util.Collections;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * One local notification, checked. Pure. What a notice says is its poster's count
 * and state; what a tap on it opens is one of this app's own links and nothing else.
 */
final class Notice {
    private static final Pattern ID = Pattern.compile("[a-z0-9-]{1,40}");
    /** A channel's importance is fixed once it exists, so the channels are few and named for what may be silenced. */
    static final String[] CHANNELS = { LocalNotices.UPLOADS, LocalNotices.GENERAL };
    private static final int MAX_TITLE = 80;
    private static final int MAX_TEXT = 300;

    final String id;
    final String channel;
    final String title;
    final String text;
    /** A daylight:// link opened on tap, or "" to open the app. */
    final String uri;

    /** The one action button: its text and the daylight:// link it opens. Both "" for none. */
    final String actionLabel;
    final String actionUri;

    private Notice(String id, String channel, String title, String text, String uri, String actionLabel, String actionUri) {
        this.id = id;
        this.channel = channel;
        this.title = title;
        this.text = text;
        this.uri = uri;
        this.actionLabel = actionLabel;
        this.actionUri = actionUri;
    }

    static Notice of(String id, String channel, String title, String text, String uri, String installKey) {
        return of(id, channel, title, text, uri, "", "", installKey);
    }

    /** @param installKey added to a link of a kind that needs it; the app posts the notice itself, so its tap may carry it */
    static Notice of(String id, String channel, String title, String text, String uri, String actionLabel, String actionUri,
                     String installKey) {
        if (id == null || !ID.matcher(id).matches()) throw new IllegalArgumentException("notice id must match [a-z0-9-]{1,40}");
        boolean known = false;
        for (String c : CHANNELS) known |= c.equals(channel);
        if (!known) throw new IllegalArgumentException("unknown channel");
        String heading = title == null ? "" : title.trim();
        if (heading.isEmpty() || heading.length() > MAX_TITLE) throw new IllegalArgumentException("notice title must be 1 to 80 characters");
        String body = text == null ? "" : text;
        if (body.length() > MAX_TEXT) body = body.substring(0, MAX_TEXT);
        String label = actionLabel == null ? "" : actionLabel.trim();
        String action = actionUri == null ? "" : actionUri.trim();
        if (label.isEmpty() != action.isEmpty() || label.length() > 20) {
            throw new IllegalArgumentException("a notice's action needs a label of 1 to 20 characters and a link");
        }
        return new Notice(id, channel, heading, body, ownLink(uri, installKey), label, ownLink(action, installKey));
    }

    /** A link a notice may open: "" or one of this app's own, given the install key where its kind needs it. */
    private static String ownLink(String uri, String installKey) {
        String link = uri == null ? "" : uri.trim();
        if (!link.isEmpty()) {
            DeepLink parsed;
            try {
                if (!link.toLowerCase(Locale.ROOT).startsWith(DeepLink.SCHEME + "://")) throw new IllegalArgumentException("not a link of this app");
                parsed = DeepLink.parse(link, Collections.<String>emptySet());
            } catch (IllegalArgumentException notOurs) {
                throw new IllegalArgumentException("a notice opens only this app's own links");
            }
            if (parsed.needsKey() && !parsed.authorized(installKey) && installKey != null && installKey.length() >= 32) {
                link = DeepLink.withKey(link, installKey);
            }
        }
        return link;
    }

    String androidChannel() { return "daylight_" + channel; }

    /** The integer Android keys a notification by. Stable for an id, and clear of the fixed ids used elsewhere. */
    int androidId() { return androidId(id); }

    static int androidId(String id) { return 1000 + (id.hashCode() & 0x7fffffff) % 1_000_000; }
}
