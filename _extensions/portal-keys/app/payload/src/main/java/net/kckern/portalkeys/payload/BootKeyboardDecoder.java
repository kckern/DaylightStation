package net.kckern.portalkeys.payload;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Stateful decoder for the standard eight-byte USB HID boot-keyboard report. */
final class BootKeyboardDecoder {
    private int modifiers;
    private boolean capsLock;
    private final Map<Integer, HidKeyEvent> down = new LinkedHashMap<>();

    List<HidKeyEvent> accept(byte[] report) {
        List<HidKeyEvent> out = new ArrayList<>();
        if (report == null || report.length < 8) return out;

        int nextModifiers = report[0] & 0xff;
        Set<Integer> next = new LinkedHashSet<>();
        for (int i = 2; i < 8; i++) {
            int usage = report[i] & 0xff;
            // 0 is empty. 1-3 are rollover/error markers, never actual keys.
            if (usage >= 4) next.add(usage);
        }

        // Release ordinary keys while their original key value/modifier snapshot is known.
        for (Integer usage : new ArrayList<>(down.keySet())) {
            if (usage < 224 && !next.contains(usage)) {
                HidKeyEvent original = down.remove(usage);
                out.add(copy(original, "up", false));
            }
        }

        // Modifier downs precede ordinary key downs in the same report.
        for (int bit = 0; bit < 8; bit++) {
            int mask = 1 << bit;
            if ((nextModifiers & mask) != 0 && (modifiers & mask) == 0) {
                int usage = 224 + bit;
                HidKeyEvent event = eventFor(usage, "down", nextModifiers);
                down.put(usage, event);
                out.add(event);
            }
        }

        for (Integer usage : next) {
            if (!down.containsKey(usage)) {
                HidKeyEvent event = eventFor(usage, "down", nextModifiers);
                down.put(usage, event);
                out.add(event);
                if (usage == 57) capsLock = !capsLock;
            }
        }

        // Modifier ups follow ordinary key ups so keyup retains the prior modifier state.
        for (int bit = 0; bit < 8; bit++) {
            int mask = 1 << bit;
            if ((nextModifiers & mask) == 0 && (modifiers & mask) != 0) {
                int usage = 224 + bit;
                HidKeyEvent original = down.remove(usage);
                if (original != null) out.add(copy(original, "up", false));
            }
        }
        modifiers = nextModifiers;
        return out;
    }

    List<HidKeyEvent> releaseAll() {
        List<HidKeyEvent> out = new ArrayList<>();
        for (HidKeyEvent event : down.values()) out.add(copy(event, "up", false));
        down.clear();
        modifiers = 0;
        return out;
    }

    private HidKeyEvent eventFor(int usage, String action, int mods) {
        boolean ctrl = (mods & 0x11) != 0;
        boolean shift = (mods & 0x22) != 0;
        boolean alt = (mods & 0x44) != 0;
        boolean meta = (mods & 0x88) != 0;
        KeyDef d = keyDef(usage, shift, capsLock);
        return new HidKeyEvent(usage, action, d.key, d.code, d.location,
                ctrl, shift, alt, meta, false);
    }

    private static HidKeyEvent copy(HidKeyEvent e, String action, boolean repeat) {
        return new HidKeyEvent(e.usage, action, e.key, e.code, e.location,
                e.ctrl, e.shift, e.alt, e.meta, repeat);
    }

    private static KeyDef keyDef(int usage, boolean shift, boolean caps) {
        if (usage >= 4 && usage <= 29) {
            char lower = (char) ('a' + usage - 4);
            boolean upper = shift ^ caps;
            return new KeyDef(String.valueOf(upper ? Character.toUpperCase(lower) : lower),
                    "Key" + Character.toUpperCase(lower), 0);
        }
        if (usage >= 30 && usage <= 39) {
            String normal = "1234567890";
            String shifted = "!@#$%^&*()";
            int i = usage - 30;
            return new KeyDef(String.valueOf((shift ? shifted : normal).charAt(i)),
                    "Digit" + normal.charAt(i), 0);
        }
        switch (usage) {
            case 40: return k("Enter", "Enter");
            case 41: return k("Escape", "Escape");
            case 42: return k("Backspace", "Backspace");
            case 43: return k("Tab", "Tab");
            case 44: return k(" ", "Space");
            case 45: return k(shift ? "_" : "-", "Minus");
            case 46: return k(shift ? "+" : "=", "Equal");
            case 47: return k(shift ? "{" : "[", "BracketLeft");
            case 48: return k(shift ? "}" : "]", "BracketRight");
            case 49: return k(shift ? "|" : "\\", "Backslash");
            case 50: return k(shift ? "|" : "\\", "IntlHash");
            case 51: return k(shift ? ":" : ";", "Semicolon");
            case 52: return k(shift ? "\"" : "'", "Quote");
            case 53: return k(shift ? "~" : "`", "Backquote");
            case 54: return k(shift ? "<" : ",", "Comma");
            case 55: return k(shift ? ">" : ".", "Period");
            case 56: return k(shift ? "?" : "/", "Slash");
            case 57: return k("CapsLock", "CapsLock");
            case 70: return k("PrintScreen", "PrintScreen");
            case 71: return k("ScrollLock", "ScrollLock");
            case 72: return k("Pause", "Pause");
            case 73: return k("Insert", "Insert");
            case 74: return k("Home", "Home");
            case 75: return k("PageUp", "PageUp");
            case 76: return k("Delete", "Delete");
            case 77: return k("End", "End");
            case 78: return k("PageDown", "PageDown");
            case 79: return k("ArrowRight", "ArrowRight");
            case 80: return k("ArrowLeft", "ArrowLeft");
            case 81: return k("ArrowDown", "ArrowDown");
            case 82: return k("ArrowUp", "ArrowUp");
            case 83: return k("NumLock", "NumLock");
            case 84: return kp("/", "NumpadDivide");
            case 85: return kp("*", "NumpadMultiply");
            case 86: return kp("-", "NumpadSubtract");
            case 87: return kp("+", "NumpadAdd");
            case 88: return kp("Enter", "NumpadEnter");
            case 89: return kp("1", "Numpad1");
            case 90: return kp("2", "Numpad2");
            case 91: return kp("3", "Numpad3");
            case 92: return kp("4", "Numpad4");
            case 93: return kp("5", "Numpad5");
            case 94: return kp("6", "Numpad6");
            case 95: return kp("7", "Numpad7");
            case 96: return kp("8", "Numpad8");
            case 97: return kp("9", "Numpad9");
            case 98: return kp("0", "Numpad0");
            case 99: return kp(".", "NumpadDecimal");
            case 224: return new KeyDef("Control", "ControlLeft", 1);
            case 225: return new KeyDef("Shift", "ShiftLeft", 1);
            case 226: return new KeyDef("Alt", "AltLeft", 1);
            case 227: return new KeyDef("Meta", "MetaLeft", 1);
            case 228: return new KeyDef("Control", "ControlRight", 2);
            case 229: return new KeyDef("Shift", "ShiftRight", 2);
            case 230: return new KeyDef("Alt", "AltRight", 2);
            case 231: return new KeyDef("Meta", "MetaRight", 2);
            default:
                if (usage >= 58 && usage <= 69) {
                    int n = usage - 57;
                    return k("F" + n, "F" + n);
                }
                return k("Unidentified", "Unidentified");
        }
    }

    private static KeyDef k(String key, String code) { return new KeyDef(key, code, 0); }
    private static KeyDef kp(String key, String code) { return new KeyDef(key, code, 3); }

    private static final class KeyDef {
        final String key;
        final String code;
        final int location;
        KeyDef(String key, String code, int location) {
            this.key = key;
            this.code = code;
            this.location = location;
        }
    }
}
