package net.kckern.daylight.core.spi;

/**
 * Provided by `notifications`: the app's own local notifications, for a capability
 * that has something to tell the owner while the app is out of sight (a memo that is
 * waiting, one that could not be sent). In process only; there is no push transport
 * behind it. A consumer must cope with the provider being absent, and with a post
 * that shows nothing because the owner has not allowed notifications.
 *
 * What goes into a notice is a count and a state. It is shown on a lock screen, so a
 * caller never puts what was said, played or opened into one.
 */
public interface LocalNotices {
    /** The channel for the upload queue's states. Low importance: no sound. */
    String UPLOADS = "uploads";
    /** The channel for anything else. */
    String GENERAL = "general";

    /**
     * Show the notice with this id, replacing the one already shown under it.
     *
     * @param id      [a-z0-9-]{1,40}; one notice per id
     * @param channel UPLOADS or GENERAL
     * @param title   1 to 80 characters
     * @param text    at most 300 characters are shown
     * @param linkUri the daylight:// link a tap opens, through the link activity; "" to open the app.
     *                A link of a kind that needs the install key is given it by the provider.
     * @throws IllegalArgumentException when the notice cannot be posted as described
     */
    void post(String id, String channel, String title, String text, String linkUri);

    /** Remove the notice with this id. Nothing happens when none is shown. */
    void cancel(String id);
}
