package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class DocumentTrustTest {
    @Test public void aDocumentTheAppLoadedMayBeGivenCapture() {
        DocumentTrust t = new DocumentTrust();
        assertFalse("the start page, before any link", t.openedFromOutside());
        t.loadedByApp();
        assertTrue(DocumentTrust.mayCapture(true, true, true, t.openedFromOutside()));
    }

    @Test public void aDocumentOpenedByAnUnkeyedLinkIsNeverGivenCapture() {
        DocumentTrust t = new DocumentTrust();
        t.loadedFromOutside();
        assertTrue(t.openedFromOutside());
        assertFalse("every other condition holds", DocumentTrust.mayCapture(true, true, true, t.openedFromOutside()));
    }

    @Test public void theMarkStaysThroughAReloadAndAPageStartedNavigation() {
        DocumentTrust t = new DocumentTrust();
        t.loadedFromOutside();
        // A retry, a Back-key reload, a renderer rebuild and a script-started navigation
        // tell the rule nothing, so nothing changes.
        t.pageNavigated(false);
        assertTrue(t.openedFromOutside());
    }

    @Test public void aNavigationTheUserStartedOrALoadByTheAppClearsTheMark() {
        DocumentTrust t = new DocumentTrust();
        t.loadedFromOutside();
        t.pageNavigated(true);
        assertFalse("a tap on a link inside the page", t.openedFromOutside());
        t.loadedFromOutside();
        t.loadedByApp();
        assertFalse("a keyed link, the start page, a control route", t.openedFromOutside());
    }

    @Test public void captureStillNeedsTheOriginTheSettingAndTheAndroidPermission() {
        assertFalse(DocumentTrust.mayCapture(false, true, true, false));
        assertFalse(DocumentTrust.mayCapture(true, false, true, false));
        assertFalse(DocumentTrust.mayCapture(true, true, false, false));
        assertTrue(DocumentTrust.mayCapture(true, true, true, false));
    }
}
