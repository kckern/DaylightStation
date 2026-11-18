package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.junit.Test;

public class AuthTest {
    private static final String TOKEN = "0123456789abcdef0123456789abcdef";

    @Test public void acceptsTheExactToken() { assertTrue(new Auth(TOKEN).accepts(TOKEN)); }

    @Test public void rejectsAWrongMissingOrPrefixToken() {
        Auth auth = new Auth(TOKEN);
        assertFalse(auth.accepts(null));
        assertFalse(auth.accepts(""));
        assertFalse(auth.accepts(TOKEN.substring(0, 31)));
        assertFalse(auth.accepts(TOKEN + "0"));
        assertFalse(auth.accepts(TOKEN.replace('0', '1')));
    }

    @Test(expected = IllegalArgumentException.class)
    public void refusesToRunWithoutAToken() { new Auth(""); }

    @Test(expected = IllegalArgumentException.class)
    public void refusesAShortToken() { new Auth("short"); }
}
