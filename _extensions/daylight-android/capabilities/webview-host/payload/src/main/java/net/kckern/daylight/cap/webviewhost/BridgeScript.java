package net.kckern.daylight.cap.webviewhost;

import org.json.JSONObject;

/** The JavaScript the native side puts into the page. Pure Java. */
final class BridgeScript {
    /** The raw addJavascriptInterface object. Useless without the token the shim holds. */
    static final String NATIVE_NAME = "__daylightNative";

    private BridgeScript() { }

    /**
     * Defines window.daylight (frozen) over the native object. Safe to run twice.
     * Injected at document start only, into frames of an allowed origin. It carries the
     * session key, with which this document asks for a token of its own; every call
     * after that presents the token, which stops working when the document is replaced.
     */
    static String shim(String sessionKey, String version, String deviceId) {
        return shim(sessionKey, version, deviceId, false);
    }

    /**
     * @param pinMedia whether the build offers pinMedia and canPinMedia: only a build
     *                 that lists media-service (a MediaPinner is provided). Without it
     *                 the members do not exist in the page.
     */
    static String shim(String sessionKey, String version, String deviceId, boolean pinMedia) {
        return "(function(){"
                + "if(window.daylight)return;"
                + "var n=window." + NATIVE_NAME + ";if(!n)return;"
                // The token is asked for at the first call and kept. Asking at document start
                // would make one refused answer last for the document's whole life.
                + "var T=\"\";function t(){if(!T){try{T=n.open(" + JSONObject.quote(sessionKey)
                + ",window.top===window?\"top\":\"frame\")||\"\";}catch(e){}}return T;}"
                + "function c(m,a){try{return n.call(t(),m,a===undefined||a===null?\"\":String(a));}catch(e){return \"\";}}"
                + "var piano=null;if(" + "piano".equals(deviceId)
                + "&&window===window.top){"
                + "piano=Object.freeze({subscribe:function(f){"
                + "function read(){var frames=JSON.parse(c('pianoRead')||'[]');frames.forEach(f);}"
                + "function status(){var s=c('pianoStatus');if(s)f(JSON.parse(s));}"
                + "window.addEventListener('daylight:midiready',read);"
                + "if(c('pianoSubscribe')!=='true'){window.removeEventListener('daylight:midiready',read);return null;}"
                + "status();var timer=setInterval(status,1000);return function(){clearInterval(timer);"
                + "window.removeEventListener('daylight:midiready',read);c('pianoUnsubscribe');};},"
                + "send:function(bytes,inMs){return c('pianoSend',JSON.stringify({bytes:Array.from(bytes),inMs:inMs||0}))==='true';}});}"
                + "window.daylight=Object.freeze({"
                + ("piano".equals(deviceId) ? "get piano(){return /^\\/piano(?:\\/|$)/.test(location.pathname)?piano:null;}," : "")
                + "version:" + JSONObject.quote(version) + ","
                + "deviceId:" + JSONObject.quote(deviceId) + ","
                + "capabilities:function(){return c(\"capabilities\")||\"[]\";},"
                + "launch:function(j){return c(\"launch\",typeof j===\"string\"?j:JSON.stringify(j))===\"true\";},"
                + "screen:function(on){return c(\"screen\",on?\"true\":\"false\")===\"true\";},"
                + "restartApp:function(){c(\"restartApp\");},"
                + "reboot:function(){return c(\"reboot\")===\"true\";},"
                + "setBackMode:function(m){c(\"setBackMode\",m);},"
                + "volume:function(s){return c(\"volume\",s===undefined?3:s)||\"{}\";}"
                + (pinMedia ? ","
                        + "canPinMedia:function(){return c(\"canPinMedia\")===\"true\";},"
                        + "pinMedia:function(j){var r=c(\"pinMedia\",typeof j===\"string\"?j:JSON.stringify(j));"
                        + "try{var o=JSON.parse(r);if(o&&typeof o.accepted===\"boolean\")return o;}catch(e){}"
                        + "return {accepted:false,reason:\"refused\"};}" : "")
                + "});"
                + "})();";
    }

    /** Dispatches daylight:<name> on window. detailJson must be a JSON object's text. */
    static String event(String name, String detailJson) {
        if (name == null || !name.matches("[a-z]+")) throw new IllegalArgumentException("bad event name");
        String detail = detailJson.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029");
        return "window.dispatchEvent(new CustomEvent(" + JSONObject.quote("daylight:" + name) + ",{detail:" + detail + "}));";
    }
}
