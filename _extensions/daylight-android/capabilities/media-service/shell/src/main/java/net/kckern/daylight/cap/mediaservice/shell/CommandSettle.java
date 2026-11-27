package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;

/**
 * When a command to a screen counts as settled, so the button the person pressed keeps
 * its new state (Media3's placeholder, held while the command's future is pending) until
 * the screen's own answer shows it, or a short deadline passes. Before, the future ended
 * on the first read after the command: a screen a beat slow to report flipped Pause back
 * to Play, then to Pause again on the next read. Pure.
 *
 * <p>Commands whose result has a field to compare (play/pause, shuffle, repeat, volume)
 * wait for it; any other (a skip, a seek, a queue change) settles on the first read.
 */
final class CommandSettle {
    /** At most this long after the command was answered. */
    static final long HOLD_MS = 3_000;
    /** Between reads while holding. */
    static final long READ_EVERY_MS = 400;

    private final String field;
    private final Object want;

    private CommandSettle(String field, Object want) {
        this.field = field;
        this.want = want;
    }

    /** What {@code request} (a ScreenCommands request) should show once done. */
    static CommandSettle of(JSONObject request) {
        if (request == null) return new CommandSettle(null, null);
        String command = request.optString("command");
        switch (command) {
            case "transport": {
                String action = request.optString("action");
                if ("play".equals(action)) return new CommandSettle("playing", Boolean.TRUE);
                if ("pause".equals(action)) return new CommandSettle("playing", Boolean.FALSE);
                return new CommandSettle(null, null);
            }
            case "shuffle": return new CommandSettle("shuffle", request.optBoolean("enabled"));
            case "repeat": return new CommandSettle("repeat", request.optString("mode", "off"));
            case "volume": return new CommandSettle("volume", request.optInt("level", -1));
            default: return new CommandSettle(null, null);
        }
    }

    /** Whether {@code snap} shows the command done. A command with nothing to compare is done at once. */
    boolean met(ScreenSnapshot snap) {
        if (field == null) return true;
        if (snap == null || snap.failed()) return false;
        switch (field) {
            case "playing": return ScreenCommands.playWhenReady(snap) == (Boolean) want;
            case "shuffle": return snap.shuffle == (Boolean) want;
            case "repeat": return want.equals(snap.repeat);
            default: return snap.volume == (Integer) want;
        }
    }

    /** Read again (true) or settle on what the screen said (false). */
    boolean again(ScreenSnapshot snap, long sinceAnswerMs) {
        return !met(snap) && sinceAnswerMs < HOLD_MS;
    }
}
