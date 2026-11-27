package net.kckern.daylight.cap.mediaservice.shell;

import net.kckern.daylight.shellkit.KeptIndex;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * On this phone's rows (D12): the state is shown by the row's icon, and the verbs live in the
 * row's ⋮ item sheet, never as buttons on the row. Pure.
 */
final class KeepRowState {
    private KeepRowState() { }

    /** The icon at the row's end. ERROR is the one that acts when tapped (Retry). */
    enum Glyph { KEPT, MOVING, STALLED, PAUSED, WAITING, ERROR }

    enum Verb { RESTART, RETRY, RESUME, PAUSE, MOBILE_ONCE, REMOVE }

    /** A download whose bytes stopped (live, not in the index) shows the retry icon; tapping it restarts the transfer. */
    static Glyph glyph(JSONObject k, boolean stalled) {
        Glyph g = glyph(k);
        return stalled && g == Glyph.MOVING ? Glyph.STALLED : g;
    }

    static Glyph glyph(JSONObject k) {
        String s = k.optString("state", "");
        if (KeptIndex.retryable(k) || KeptIndex.DAMAGED.equals(s) || KeptIndex.NOT_AVAILABLE.equals(s)) return Glyph.ERROR;
        if (KeptIndex.PAUSED.equals(s)) return Glyph.PAUSED;
        if (KeptIndex.READY.equals(s)) return Glyph.KEPT;
        if (KeptIndex.DOWNLOADING.equals(s) || KeptIndex.QUEUED.equals(s) || KeptIndex.UPDATING.equals(s)
                || KeptIndex.CHECKING.equals(s) || KeptIndex.REMOVING.equals(s)) return Glyph.MOVING;
        return Glyph.WAITING;
    }

    /** The sheet's verbs for a row in this state, Remove last (it is destructive). */
    static List<Verb> verbs(JSONObject k, boolean stalled) {
        List<Verb> out = verbs(k);
        if (stalled && out.contains(Verb.PAUSE)) out.add(0, Verb.RESTART);
        return out;
    }

    static List<Verb> verbs(JSONObject k) {
        List<Verb> out = new ArrayList<>();
        String s = k.optString("state", "");
        switch (KeptIndex.action(k)) {
            case "Retry": out.add(Verb.RETRY); break;
            case "Resume": out.add(Verb.RESUME); break;
            case "Use mobile data once": out.add(Verb.MOBILE_ONCE); break;
            default: break;
        }
        if (KeptIndex.DOWNLOADING.equals(s) || KeptIndex.QUEUED.equals(s) || KeptIndex.UPDATING.equals(s)) out.add(Verb.PAUSE);
        if (!KeptIndex.REMOVING.equals(s) && !KeptIndex.CHECKING.equals(s)) out.add(Verb.REMOVE);
        return out;
    }
}
