package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class CertificatePinsTest {
    private static final String CERT = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @Test public void readsPackagesAndDigestsAsToolsPrintThem() throws Exception {
        String printed = CERT.toUpperCase(java.util.Locale.ROOT).replaceAll("(..)", "$1:").replaceAll(":$", "");
        assertEquals(CERT, CertificatePins.parse("com.example.host = " + printed).get("com.example.host"));
        assertEquals(CERT, new JSONObject(CertificatePins.cacheJson("com.example.host=" + CERT)).getString("com.example.host"));
        assertEquals("{}", CertificatePins.cacheJson(""));
    }

    @Test public void aProblemNeverRepeatsTheValue() {
        String p = CertificatePins.problem("secret.example.host=nothex");
        assertNotNull(p);
        assertFalse(p.contains("secret"));
        assertFalse(p.contains("nothex"));
    }
}
