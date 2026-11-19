package net.kckern.daylight.cap.webviewhost;

/**
 * How the document in the page came to be there, for one decision: whether it may be
 * given the microphone or the camera. Pure Java.
 *
 * The link activity is exported, so any app or web page on the device can make the app
 * open a page of the site, and a page can ask for capture the moment it loads. A
 * document opened that way, by a link that did not carry the install key, is never
 * given capture. The mark is cleared by a load the app started itself (the start page,
 * a keyed link, a control route) and by a navigation the user started with a tap
 * inside the page. A retry, a reload, a rebuilt renderer and a navigation a script
 * started say nothing about who asked, so they leave the mark as it is.
 *
 * A device with no link activity (a kiosk) never sets the mark.
 */
final class DocumentTrust {
    private volatile boolean outside;

    void loadedByApp() { outside = false; }

    void loadedFromOutside() { outside = true; }

    /** A main-frame navigation the page made. Only one with a user gesture changes anything. */
    void pageNavigated(boolean userGesture) { if (userGesture) outside = false; }

    boolean openedFromOutside() { return outside; }

    /** Every condition must hold. The last is this class's own. */
    static boolean mayCapture(boolean originAllowed, boolean settingAllows, boolean holdsAndroidPermission,
                              boolean openedFromOutside) {
        return originAllowed && settingAllows && holdsAndroidPermission && !openedFromOutside;
    }
}
