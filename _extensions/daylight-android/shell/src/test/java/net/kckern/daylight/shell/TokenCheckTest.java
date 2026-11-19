package net.kckern.daylight.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class TokenCheckTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";

    @Test public void acceptsOnlyTheExactToken() {
        assertTrue(TokenCheck.accepts(TOKEN, TOKEN));
        assertFalse(TokenCheck.accepts(TOKEN, null));
        assertFalse(TokenCheck.accepts(TOKEN, ""));
        assertFalse(TokenCheck.accepts(TOKEN, TOKEN + "x"));
    }

    @Test public void anUnconfiguredShellAcceptsNothing() {
        assertFalse(TokenCheck.accepts("", ""));
        assertFalse(TokenCheck.accepts(null, null));
        assertFalse(TokenCheck.accepts("short", "short"));
    }
}
