package net.kckern.daylight.cap.debugtools;

import java.util.Locale;

/**
 * The query of /debug/logcat. Pure Java. `lines` is a whole number in range and the only
 * thing of the caller's that reaches the command, which is an argument list run with no
 * shell. `filter` is a plain, case-insensitive substring applied here, never passed on.
 */
final class LogFilter {
    static final int DEFAULT_LINES = 500;
    static final int MAX_LINES = 5000;
    static final int MAX_FILTER_CHARS = 200;

    private LogFilter() { }

    /** The line count, or IllegalArgumentException (HTTP 400) for anything but a whole number in 1..MAX_LINES. */
    static int lines(String raw) {
        if (raw == null) return DEFAULT_LINES;
        if (!raw.matches("[0-9]{1,6}")) throw new IllegalArgumentException("query 'lines' must be a whole number from 1 to " + MAX_LINES);
        int n = Integer.parseInt(raw);
        if (n < 1 || n > MAX_LINES) throw new IllegalArgumentException("query 'lines' must be from 1 to " + MAX_LINES);
        return n;
    }

    /** Null when the filter is usable, otherwise why not. */
    static String problem(String needle) {
        if (needle == null) return null;
        if (needle.length() > MAX_FILTER_CHARS) return "query 'filter' is longer than " + MAX_FILTER_CHARS + " characters";
        for (int i = 0; i < needle.length(); i++) {
            if (needle.charAt(i) < 0x20) return "query 'filter' must be one line of plain text";
        }
        return null;
    }

    static String[] command(int lines) {
        return new String[] { "logcat", "-d", "-v", "time", "-t", String.valueOf(lines) };
    }

    static String apply(String text, String needle) {
        if (needle == null || needle.isEmpty() || text == null) return text == null ? "" : text;
        String n = needle.toLowerCase(Locale.ROOT);
        StringBuilder out = new StringBuilder();
        for (String line : text.split("\n")) {
            if (line.toLowerCase(Locale.ROOT).contains(n)) out.append(line).append('\n');
        }
        return out.toString();
    }
}
