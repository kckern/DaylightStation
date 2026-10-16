package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * FKB answers a wrong password with HTTP 200 and
 * {@code {"status":"Error","statustext":"Please login"}}.
 *
 * Why this exists: on 2026-10-14 the bridge's fkbPassword was stale. Every call got
 * that envelope, and every caller read it as success or as "unknown": the foreground
 * guard sat at UNKNOWN while a child was in the Play Store for 40 minutes, the
 * settings guard reported OK, and the recovery ladder's loadStartUrl / restartApp /
 * rebootDevice were all no-ops. The envelope must be recognised as an auth failure.
 */
public class FkbRestAuthEnvelopeTest {

    private static final String LOGIN = "{\"status\":\"Error\",\"statustext\":\"Please login\"}";

    @Test
    public void loginEnvelope_isAnError() {
        assertEquals("Please login", FkbRest.errorEnvelope(LOGIN));
    }

    @Test
    public void okAck_andPayloads_areNotErrors() {
        assertNull(FkbRest.errorEnvelope("{\"status\":\"OK\",\"statustext\":\"Loading start URL\"}"));
        assertNull(FkbRest.errorEnvelope("{\"foregroundApp\":\"de.ozerov.fully\",\"screenOn\":true}"));
        assertNull(FkbRest.errorEnvelope("<html>not json</html>"));
        assertNull(FkbRest.errorEnvelope(""));
        assertNull(FkbRest.errorEnvelope(null));
    }

    @Test
    public void errorWithoutText_stillCountsAsError() {
        assertEquals("Error", FkbRest.errorEnvelope("{\"status\":\"Error\"}"));
    }

    @Test
    public void loginEnvelope_parsesToNoSettings() {
        // Before: {status, statustext} came back as two "settings", none of the desired
        // keys were present, detect() found no drift, and the guard said OK.
        assertTrue(FkbRest.parseSettings(LOGIN).isEmpty());
    }

    @Test
    public void authState_tracksTheLatestAnswer() {
        FkbRest.recordAuth(true);
        assertFalse(FkbRest.authFailing());
        FkbRest.recordAuth(false);
        assertTrue(FkbRest.authFailing());
        FkbRest.recordAuth(true);
        assertFalse(FkbRest.authFailing());
    }
}
