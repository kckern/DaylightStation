package net.kckern.portalkeys.payload;

final class HidKeyEvent {
    final int usage;
    final String action;
    final String key;
    final String code;
    final int location;
    final boolean ctrl;
    final boolean shift;
    final boolean alt;
    final boolean meta;
    final boolean repeat;

    HidKeyEvent(int usage, String action, String key, String code, int location,
                boolean ctrl, boolean shift, boolean alt, boolean meta, boolean repeat) {
        this.usage = usage;
        this.action = action;
        this.key = key;
        this.code = code;
        this.location = location;
        this.ctrl = ctrl;
        this.shift = shift;
        this.alt = alt;
        this.meta = meta;
        this.repeat = repeat;
    }

    HidKeyEvent asRepeat() {
        return new HidKeyEvent(usage, "down", key, code, location, ctrl, shift, alt, meta, true);
    }

    boolean repeatable() {
        return usage < 224 && !"CapsLock".equals(key) && !"NumLock".equals(key)
                && !"ScrollLock".equals(key) && !"Pause".equals(key);
    }

    String toJson() {
        return Jsons.object(
                "type", "keyboard", "action", action, "key", key, "code", code,
                "location", location, "ctrlKey", ctrl, "shiftKey", shift,
                "altKey", alt, "metaKey", meta, "repeat", repeat,
                "ts", System.currentTimeMillis()).toString();
    }
}
