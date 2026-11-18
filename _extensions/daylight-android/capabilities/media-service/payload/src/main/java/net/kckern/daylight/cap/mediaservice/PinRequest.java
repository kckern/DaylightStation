package net.kckern.daylight.cap.mediaservice;

/**
 * What a page may ask to pin (the page bridge's pinMedia). Pure.
 *
 * The content id is held to the media service's own rule (ContentId): no URL, no
 * relative or empty segment, no modifier segment. The label is what the launcher and
 * the button widget show, so it is 1 to 40 visible characters after trimming, with no
 * control character, no line or paragraph separator, no lone surrogate and no format
 * character (which covers the bidi overrides and isolates, the marks and the
 * zero-width characters a label could hide or reorder text with).
 */
final class PinRequest {
    static final String INVALID_CONTENT_ID = "invalid_content_id";
    static final String INVALID_LABEL = "invalid_label";
    static final int MAX_LABEL = 40;

    private PinRequest() { }

    /** The refusal reason, or null when both may be pinned. */
    static String problem(String contentId, String label) {
        if (!ContentId.valid(contentId)) return INVALID_CONTENT_ID;
        return labelOk(label) ? null : INVALID_LABEL;
    }

    static String label(String raw) { return raw == null ? null : raw.trim(); }

    private static boolean labelOk(String raw) {
        String label = label(raw);
        if (label == null || label.isEmpty()) return false;
        int count = 0;
        for (int i = 0; i < label.length(); ) {
            int cp = label.codePointAt(i);
            if (refused(cp)) return false;
            if (++count > MAX_LABEL) return false;
            i += Character.charCount(cp);
        }
        return true;
    }

    private static boolean refused(int cp) {
        switch (Character.getType(cp)) {
            case Character.CONTROL:
            case Character.FORMAT:
            case Character.SURROGATE:
            case Character.LINE_SEPARATOR:
            case Character.PARAGRAPH_SEPARATOR:
            case Character.UNASSIGNED:
            case Character.PRIVATE_USE:
                return true;
            default:
                return false;
        }
    }
}
