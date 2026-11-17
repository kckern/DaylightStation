package net.kckern.daylight.cap.webviewhost;

import org.json.JSONObject;

/** The JavaScript the native side puts into the page. Pure Java. */
final class BridgeScript {
    /** The raw addJavascriptInterface object. Useless without the token the shim holds. */
    static final String NATIVE_NAME = "__daylightNative";

    private BridgeScript() { }

    /** Defines window.daylight (frozen) over the native object. Safe to run twice. */
    static String shim(String token, String version, String deviceId) {
        return "(function(){"
                + "if(window.daylight)return;"
                + "var n=window." + NATIVE_NAME + ";if(!n)return;"
                + "var T=" + JSONObject.quote(token) + ";"
                + "function c(m,a){try{return n.call(T,m,a===undefined||a===null?\"\":String(a));}catch(e){return \"\";}}"
                + "window.daylight=Object.freeze({"
                + "version:" + JSONObject.quote(version) + ","
                + "deviceId:" + JSONObject.quote(deviceId) + ","
                + "capabilities:function(){return c(\"capabilities\")||\"[]\";},"
                + "launch:function(j){return c(\"launch\",typeof j===\"string\"?j:JSON.stringify(j))===\"true\";},"
                + "screen:function(on){return c(\"screen\",on?\"true\":\"false\")===\"true\";},"
                + "restartApp:function(){c(\"restartApp\");},"
                + "reboot:function(){return c(\"reboot\")===\"true\";},"
                + "setBackMode:function(m){c(\"setBackMode\",m);},"
                + "volume:function(s){return c(\"volume\",s===undefined?3:s)||\"{}\";}"
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
