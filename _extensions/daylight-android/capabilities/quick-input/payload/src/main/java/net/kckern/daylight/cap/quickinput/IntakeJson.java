package net.kckern.daylight.cap.quickinput;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Validates the complete wire object before Android's lenient org.json decoder sees it. */
final class IntakeJson {
    private static final Pattern STRING = Pattern.compile(
            "\"(?:[^\"\\\\\\x00-\\x1f]|\\\\(?:[\"\\\\/bfnrt]|u[0-9a-fA-F]{4}))*+\"");
    private static final Pattern SCALAR = Pattern.compile(
            "true|false|null|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?");
    // Server responses are shallow. Bound recursion on replies from other services.
    private static final int MAX_DEPTH = 64;

    static JSONObject parse(String body) throws JSONException {
        if (body == null) throw invalid();
        IntakeJson parser = new IntakeJson(body);
        parser.object(1);
        parser.skipWhitespace();
        if (parser.position != body.length()) throw invalid();
        return new JSONObject(body);
    }

    private final String body;
    private final Matcher token;
    private int position;

    private IntakeJson(String body) {
        this.body = body;
        this.token = STRING.matcher(body);
    }

    private void object(int depth) throws JSONException {
        expect('{');
        if (take('}')) return;
        Set<String> keys = new HashSet<>();
        do {
            skipWhitespace();
            int start = position;
            readToken(STRING);
            // Compare decoded names so a Unicode escape cannot disguise a duplicate.
            String key = (String) new JSONTokener(body.substring(start, position)).nextValue();
            if (!keys.add(key)) throw invalid();
            expect(':');
            value(depth);
        } while (take(','));
        expect('}');
    }

    private void array(int depth) throws JSONException {
        expect('[');
        if (take(']')) return;
        do {
            value(depth);
        } while (take(','));
        expect(']');
    }

    private void value(int depth) throws JSONException {
        skipWhitespace();
        if (depth >= MAX_DEPTH || position == body.length()) throw invalid();
        switch (body.charAt(position)) {
            case '{':
                object(depth + 1);
                break;
            case '[':
                array(depth + 1);
                break;
            case '"':
                readToken(STRING);
                break;
            default:
                readToken(SCALAR);
        }
    }

    private void readToken(Pattern pattern) throws JSONException {
        if (!token.usePattern(pattern).region(position, body.length()).lookingAt()) throw invalid();
        position = token.end();
    }

    private void expect(char ch) throws JSONException {
        if (!take(ch)) throw invalid();
    }

    private boolean take(char ch) {
        skipWhitespace();
        if (position == body.length() || body.charAt(position) != ch) return false;
        position++;
        return true;
    }

    private void skipWhitespace() {
        while (position < body.length()) {
            char ch = body.charAt(position);
            if (ch != ' ' && ch != '\t' && ch != '\r' && ch != '\n') return;
            position++;
        }
    }

    private static JSONException invalid() {
        return new JSONException("Invalid intake response object");
    }
}
