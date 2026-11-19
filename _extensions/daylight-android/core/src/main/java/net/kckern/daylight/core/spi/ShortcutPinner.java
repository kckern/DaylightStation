package net.kckern.daylight.core.spi;

import org.json.JSONObject;

/**
 * Provided by `one-tap-actions`: record a pinned media action and ask the launcher to
 * pin a shortcut to it (Android's own pin dialog is the confirmation). The caller
 * (MediaPinner) has already checked the content id and the label.
 *
 * The pinned action plays its content natively when it is run by its id, from the
 * pinned shortcut, a one-action button or the play service; the content id never
 * travels in a link.
 */
public interface ShortcutPinner {
    /** Whether the launcher can pin shortcuts at all. */
    boolean canPin();

    /** {accepted: boolean, reason?: string}. */
    JSONObject pinMedia(String contentId, String label) throws Exception;
}
