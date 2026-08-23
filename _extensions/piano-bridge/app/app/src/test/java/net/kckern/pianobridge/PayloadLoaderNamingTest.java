package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import org.junit.Test;

/** The only pure-Java piece of PayloadLoader; everything else needs a Context. */
public class PayloadLoaderNamingTest {

    private static final String SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test public void usesTheUrlBasename() {
        assertEquals("p2-midi-write.jar", PayloadLoader.jarNameFrom("http://10.0.0.68:8899/p2-midi-write.jar", SHA));
    }

    @Test public void stripsQueryStrings() {
        assertEquals("p3.jar", PayloadLoader.jarNameFrom("http://h/x/p3.jar?token=abc", SHA));
    }

    @Test public void scrubsUnsafeCharacters() {
        String n = PayloadLoader.jarNameFrom("http://h/we ird$name.jar", SHA);
        assertTrue(n.matches("[A-Za-z0-9._-]+\\.jar"));
    }

    @Test public void fallsBackToShaWhenNotAJar() {
        assertEquals("p-0123456789ab.jar", PayloadLoader.jarNameFrom("http://h/download?id=7", SHA));
        assertEquals("p-0123456789ab.jar", PayloadLoader.jarNameFrom("http://h/", SHA));
    }
}
