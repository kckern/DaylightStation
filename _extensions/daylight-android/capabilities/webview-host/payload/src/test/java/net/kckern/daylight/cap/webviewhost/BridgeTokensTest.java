package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class BridgeTokensTest {
    private static final String KEY = "0123456789abcdef0123456789abcdef";

    @Test public void aDocumentOpensASessionWithTheKeyAndGetsATokenOfItsOwn() {
        BridgeTokens t = new BridgeTokens(KEY);
        String a = t.open(KEY), b = t.open(KEY);
        assertEquals(32, a.length());
        assertNotEquals("every document gets its own", a, b);
        assertNotEquals("the token is not the key", KEY, a);
        assertTrue(t.valid(a));
        assertTrue(t.valid(b));
    }

    @Test public void aWrongKeyOpensNothing() {
        BridgeTokens t = new BridgeTokens(KEY);
        for (String bad : new String[] { null, "", "wrong", KEY + "0", KEY.substring(1) }) assertEquals("", t.open(bad));
        assertFalse(t.valid(""));
        assertFalse(t.valid(null));
        assertFalse("the session key itself is not a token", t.valid(KEY));
    }

    @Test public void aTokenStopsWorkingOnceItsDocumentHasBeenReplaced() {
        BridgeTokens t = new BridgeTokens(KEY);
        t.navigated();                       // document A
        String a = t.open(KEY);
        assertTrue(t.valid(a));
        t.navigated();                       // document B replaces A
        String b = t.open(KEY);
        t.navigated();                       // document C replaces B
        assertFalse("A's token cannot be used two documents later", t.valid(a));
        t.navigated();
        assertFalse(t.valid(b));
    }

    @Test public void aTokenIssuedJustBeforeItsOwnNavigationCallbackSurvivesIt() {
        // The new document's first call can reach the bridge thread before the main
        // thread hears that the navigation started.
        BridgeTokens t = new BridgeTokens(KEY);
        t.navigated();                       // document A
        String early = t.open(KEY);          // document B's first call, before B's callback
        t.navigated();                       // B's callback arrives
        assertTrue("the page's own token must keep working", t.valid(early));
        t.navigated();                       // document C replaces B
        assertFalse("and it does not outlive its document", t.valid(early));
    }

    @Test public void theTableIsBounded() {
        BridgeTokens t = new BridgeTokens(KEY);
        String first = t.open(KEY);
        for (int i = 0; i < BridgeTokens.MAX_TOKENS; i++) t.open(KEY);
        assertFalse("the oldest is dropped", t.valid(first));
    }
}
