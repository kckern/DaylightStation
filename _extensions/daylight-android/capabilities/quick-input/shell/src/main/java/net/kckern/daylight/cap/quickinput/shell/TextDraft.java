package net.kckern.daylight.cap.quickinput.shell;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * The rules of the text screen. Pure: the screen feeds it what is typed and does what
 * it answers.
 *
 * The intake takes at most 16,384 bytes of UTF-8 for a text input and refuses a body
 * with no non-whitespace character. Both are held here, as the text is typed and again
 * when it is sent, so nothing is queued that the intake would refuse for its size or
 * for being empty.
 */
final class TextDraft {
    /** The intake's limit for a text input, in bytes of UTF-8. */
    static final int MAX_BYTES = 16_384;
    /** The counter is shown once this few bytes are left. */
    static final int COUNTER_FROM = 2_048;

    static final class Snapshot {
        final String body;
        final long revision;

        Snapshot(String body, long revision) {
            this.body = body;
            this.revision = revision;
        }
    }

    private TextDraft() { }

    /** The bytes s[start, end) takes as UTF-8. A surrogate pair is four; half of one is counted as three. */
    static int utf8Length(CharSequence s, int start, int end) {
        int bytes = 0;
        for (int i = start; i < end; i++) {
            char c = s.charAt(i);
            if (c < 0x80) bytes += 1;
            else if (c < 0x800) bytes += 2;
            else if (Character.isHighSurrogate(c) && i + 1 < end && Character.isLowSurrogate(s.charAt(i + 1))) { bytes += 4; i++; }
            else bytes += 3;
        }
        return bytes;
    }

    /**
     * How many chars of source[start, end) may be added to a draft that already holds
     * keptBytes. A character of several bytes, and a surrogate pair, is taken whole or
     * not at all.
     *
     * @param keptBytes the draft's size without the range being replaced
     */
    static int accepted(int keptBytes, CharSequence source, int start, int end, int maxBytes) {
        int room = maxBytes - keptBytes;
        int i = start;
        while (i < end) {
            char c = source.charAt(i);
            boolean pair = Character.isHighSurrogate(c) && i + 1 < end && Character.isLowSurrogate(source.charAt(i + 1));
            int step = pair ? 2 : 1;
            int bytes = utf8Length(source, i, i + step);
            if (bytes > room) break;
            room -= bytes;
            i += step;
        }
        return i - start;
    }

    /**
     * What is sent for a draft: its text as UTF-8, without the space around it. Null
     * when there is nothing to send (no character that shows) or it is over the limit.
     */
    static byte[] body(String typed) {
        if (typed == null) return null;
        int from = 0, to = typed.length();
        while (from < to && blank(typed.charAt(from))) from++;
        while (to > from && blank(typed.charAt(to - 1))) to--;
        if (from == to) return null;
        byte[] body = typed.substring(from, to).getBytes(StandardCharsets.UTF_8);
        return body.length > MAX_BYTES ? null : body;
    }

    /** Space of any kind, a control character, or a character that takes no room (a zero-width space, a byte-order mark). */
    private static boolean blank(char c) {
        return Character.isWhitespace(c) || Character.isSpaceChar(c) || Character.isISOControl(c)
                || Character.getType(c) == Character.FORMAT;
    }

    /** What the screen shows under the field: nothing until the limit is near. */
    static String counter(int bytes) {
        int left = MAX_BYTES - bytes;
        if (left <= 0) return "At the limit";
        if (left > COUNTER_FROM) return "";
        return String.format(Locale.US, "%,d", left) + (left == 1 ? " byte left" : " bytes left");
    }
}
