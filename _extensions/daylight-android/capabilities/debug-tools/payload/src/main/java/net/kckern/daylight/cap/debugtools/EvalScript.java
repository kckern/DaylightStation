package net.kckern.daylight.cap.debugtools;

import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * JavaScript run in the live page for /debug/eval, /debug/html and /debug/fps. Pure Java.
 *
 * evaluateJavascript cannot wait for a Promise, so a Promise's result is parked on
 * window.__dlEval[id] and collected by polling. Every script returns a JSON string:
 * {"v":value}, {"e":"error text"}, {"pending":1} or {"big":length}.
 *
 * The size cap is applied in the page: a result whose JSON is longer than the cap is
 * replaced there by its length, so an oversized value never crosses into the app.
 * Nothing stays in the page afterwards: a read result's slot is deleted, the holder
 * goes with its last slot, and cleanup() removes a slot whose result nobody will read.
 */
final class EvalScript {
    static final class PageError extends Exception {
        PageError(String message) { super(message); }
    }

    /** The longest result /debug/eval returns, in characters of its JSON text. */
    static final int MAX_RESULT_CHARS = 1024 * 1024;

    private EvalScript() { }

    private static String id(String id) {
        if (id == null || !id.matches("[a-z0-9]{1,24}")) throw new IllegalArgumentException("bad eval id");
        return JSONObject.quote(id);
    }

    /** function o(x): x as JSON text, or {big:length} when that text is over the cap. */
    private static String out(int maxChars) {
        return "function o(x){var t;try{t=JSON.stringify(x);}catch(e){t=JSON.stringify({e:String(e&&e.message||e)});}"
                + "if(t===undefined)t=\"{}\";"
                + "return t.length>" + maxChars + "?JSON.stringify({big:t.length}):t;}";
    }

    /** function gone(): remove the holder once it has no slot left. */
    private static final String GONE = "function gone(){for(var k in s)return;try{delete window.__dlEval;}catch(e){}}";

    static String wrap(String js, String id) { return wrap(js, id, MAX_RESULT_CHARS); }

    static String wrap(String js, String id, int maxChars) {
        return "(function(){" + out(maxChars) + "var s=window.__dlEval=window.__dlEval||{},id=" + id(id) + ";" + GONE
                + "try{var v=(0,eval)(" + JSONObject.quote(js) + ");"
                + "if(v&&typeof v.then===\"function\"){var slot=s[id]={pending:1};"
                + "v.then(function(r){if(s[id]===slot)s[id]={v:r===undefined?null:r};},"
                + "function(e){if(s[id]===slot)s[id]={e:String(e&&e.message||e)};});"
                + "return o({pending:1});}"
                + "gone();return o({v:v===undefined?null:v});"
                + "}catch(e){gone();return o({e:String(e&&e.message||e)});}})()";
    }

    static String poll(String id) { return poll(id, MAX_RESULT_CHARS); }

    /** The parked result, read once and removed; "" while it is still pending. */
    static String poll(String id, int maxChars) {
        return "(function(){" + out(maxChars) + "var s=window.__dlEval,id=" + id(id) + ";"
                + "if(!s||!s[id])return o({e:\"the page changed before the result was ready\"});"
                + "var r=s[id];if(r.pending)return \"\";"
                + "delete s[id];" + GONE + "gone();return o(r);})()";
    }

    /** Remove a slot nobody will read (a timeout), cancelling the frame request it may hold. */
    static String cleanup(String id) {
        return "(function(){var s=window.__dlEval,id=" + id(id) + ";if(!s)return \"\";"
                + "var r=s[id];if(r&&r.raf)cancelAnimationFrame(r.raf);"
                + "delete s[id];" + GONE + "gone();return \"\";})()";
    }

    /**
     * Counts requestAnimationFrame callbacks for ms milliseconds in the live page and parks
     * {frames, ms, fps, visible}. The page is not reloaded and nothing is added to its
     * document. With the display off no frame runs: the caller times out and calls cleanup().
     */
    static String fpsProbe(int ms, String id) {
        return "(function(){" + out(MAX_RESULT_CHARS) + "var s=window.__dlEval=window.__dlEval||{},id=" + id(id) + ";"
                + "var slot=s[id]={pending:1,n:0,t0:performance.now(),raf:0};"
                + "function f(){if(s[id]!==slot)return;slot.n++;var d=performance.now()-slot.t0;"
                + "if(d<" + ms + "){slot.raf=requestAnimationFrame(f);}"
                + "else{s[id]={v:{frames:slot.n,ms:Math.round(d),fps:Math.round(slot.n*1000/d),visible:document.visibilityState}};}}"
                + "slot.raf=requestAnimationFrame(f);return o({pending:1});})()";
    }

    /** The evaluateJavascript callback value → our envelope, or null when there is none yet. */
    static JSONObject parse(String raw) {
        if (raw == null) return null;
        try {
            Object outer = new JSONTokener(raw).nextValue();
            if (!(outer instanceof String) || ((String) outer).isEmpty()) return null;
            return new JSONObject((String) outer);
        } catch (Exception e) {
            return null;
        }
    }
}
