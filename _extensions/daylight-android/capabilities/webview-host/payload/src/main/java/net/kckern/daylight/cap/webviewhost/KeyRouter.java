package net.kckern.daylight.cap.webviewhost;

import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * What to do with a hardware key before the WebView sees it. Pure Java: key codes are
 * the android.view.KeyEvent.KEYCODE_* values, copied so no Android class is needed.
 */
final class KeyRouter {
    static final int BACK = 4, VOLUME_UP = 24, VOLUME_DOWN = 25, VOLUME_MUTE = 164;

    enum Kind { PASS, CONSUME, PAGE_KEY, BACK_EVENT, RELOAD }

    static final class Decision {
        final Kind kind;
        final String code;
        final String action;
        Decision(Kind kind, String code, String action) { this.kind = kind; this.code = code; this.action = action; }
    }

    private static final Map<Integer, String> NAMES = new HashMap<>();
    static {
        NAMES.put(BACK, "Back");
        NAMES.put(VOLUME_UP, "VolumeUp");
        NAMES.put(VOLUME_DOWN, "VolumeDown");
        NAMES.put(VOLUME_MUTE, "VolumeMute");
        NAMES.put(82, "Menu");
        NAMES.put(84, "Search");
        NAMES.put(85, "MediaPlayPause");
        NAMES.put(86, "MediaStop");
        NAMES.put(87, "MediaNext");
        NAMES.put(88, "MediaPrevious");
        NAMES.put(89, "MediaRewind");
        NAMES.put(90, "MediaFastForward");
        NAMES.put(126, "MediaPlay");
        NAMES.put(127, "MediaPause");
        NAMES.put(27, "Camera");
        NAMES.put(91, "MicMute");
    }

    private KeyRouter() { }

    static String name(int keyCode) {
        String n = NAMES.get(keyCode);
        return n != null ? n : "Key" + keyCode;
    }

    static Set<String> parseIntercept(String csv) {
        if (csv == null) return Collections.emptySet();
        Set<String> out = new HashSet<>();
        for (String part : csv.split(",")) if (!part.trim().isEmpty()) out.add(part.trim());
        return out;
    }

    static boolean validBackMode(String mode) {
        return "page".equals(mode) || "reload".equals(mode) || "ignore".equals(mode);
    }

    static Decision route(int keyCode, boolean down, String backMode, Set<String> intercept) {
        if (keyCode == BACK) {
            if ("ignore".equals(backMode) || down) return new Decision(Kind.CONSUME, "Back", down ? "down" : "up");
            return new Decision("reload".equals(backMode) ? Kind.RELOAD : Kind.BACK_EVENT, "Back", "up");
        }
        String name = name(keyCode);
        if (intercept.contains(name)) return new Decision(Kind.PAGE_KEY, name, down ? "down" : "up");
        return new Decision(Kind.PASS, name, down ? "down" : "up");
    }
}
