package net.kckern.daylight.core.spi;

import org.json.JSONObject;

/**
 * Provided by `media-service`: pin a piece of household media as a one-tap action at
 * a page's request (the page bridge's pinMedia). A build without media-service has no
 * pinner, and its page bridge offers neither pinMedia nor canPinMedia.
 *
 * The pinner checks the content id with the media service's own rule and the label,
 * then hands both to the ShortcutPinner. Its answer is {accepted, reason?} and never
 * anything else: no link, no key, no list of what is pinned.
 */
public interface MediaPinner {
    /** Whether a request could be made now: a ShortcutPinner exists and the launcher can pin. */
    boolean canPin();

    /** {accepted: boolean, reason?: string}. Never throws. */
    JSONObject pin(String contentId, String label);
}
