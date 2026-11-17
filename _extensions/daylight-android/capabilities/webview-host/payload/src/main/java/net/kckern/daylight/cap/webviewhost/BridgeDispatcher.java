package net.kckern.daylight.cap.webviewhost;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.function.Supplier;

/**
 * Every page-to-native call lands here first. Pure Java.
 *
 * addJavascriptInterface exposes the native object to every frame of every page, so a
 * call is honored only with the per-WebView token (which only allowed-origin frames
 * are given) AND while the main frame is on an allowed origin. A refused call returns "".
 */
final class BridgeDispatcher {
    interface Actions {
        String capabilitiesJson();
        boolean launch(String json);
        boolean screen(boolean on);
        void restartApp();
        boolean reboot();
        void setBackMode(String mode);
        String volumeJson(int stream);
    }

    private final byte[] token;
    private final OriginPolicy origins;
    private final Supplier<String> mainFrameUrl;
    private final Actions actions;

    BridgeDispatcher(String token, OriginPolicy origins, Supplier<String> mainFrameUrl, Actions actions) {
        this.token = token.getBytes(StandardCharsets.UTF_8);
        this.origins = origins;
        this.mainFrameUrl = mainFrameUrl;
        this.actions = actions;
    }

    String call(String presentedToken, String method, String arg) {
        if (presentedToken == null || method == null) return "";
        if (!MessageDigest.isEqual(token, presentedToken.getBytes(StandardCharsets.UTF_8))) return "";
        if (!origins.allows(mainFrameUrl.get())) return "";
        String a = arg == null ? "" : arg;
        try {
            switch (method) {
                case "capabilities": return actions.capabilitiesJson();
                case "launch": return String.valueOf(actions.launch(a));
                case "screen": return String.valueOf(actions.screen("true".equals(a)));
                case "restartApp": actions.restartApp(); return "";
                case "reboot": return String.valueOf(actions.reboot());
                case "setBackMode": if (KeyRouter.validBackMode(a)) actions.setBackMode(a); return "";
                case "volume": return actions.volumeJson(stream(a));
                default: return "";
            }
        } catch (Throwable t) {
            return "";
        }
    }

    private static int stream(String raw) {
        try {
            int s = Integer.parseInt(raw.trim());
            return s >= 0 && s <= 10 ? s : 3;
        } catch (NumberFormatException e) {
            return 3;   // STREAM_MUSIC
        }
    }
}
