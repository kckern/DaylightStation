package net.kckern.daylight.core.spi;

/**
 * Provided by `webview-host`: show a URL in the app's own page. The caller is
 * responsible for the URL being one the app may show; this only refuses what is not
 * an http or https URL.
 */
public interface PageOpener {
    /**
     * Load the URL now when a window is hosting the page; otherwise keep it for the
     * window that attaches next, which loads it in place of the start page. A kept URL
     * is dropped after a minute, so a link that never led to a window cannot replace
     * the start page hours later.
     *
     * @return "loading" or "pending"
     * @throws IllegalArgumentException when the URL is not http or https
     */
    String open(String url);

    /**
     * The same, for a URL that came from a link without the install key: any app or web
     * page on the device can send one. The page host marks the document it opens, and a
     * document so marked is never given the microphone or the camera. A provider that
     * does not tell the two apart treats it as {@link #open}.
     */
    default String openFromOutside(String url) { return open(url); }
}
