package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.net.URLDecoder;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * URL construction for the FKB REST client.
 *
 * Why this exists: before the kiosk-settings guard, {@link FkbRest} could only fire
 * BARE commands (loadStartUrl/restartApp/…) and URL-encoded nothing but the password.
 * Writing a setting needs {@code key=}/{@code value=} params, and the real FKB
 * password contains characters that MUST be percent-encoded or the query string
 * splits in the wrong place and the call silently 401s. Both are asserted here so
 * the encoding can't regress into "works until the password changes".
 */
public class FkbRestUrlTest {

    @Test
    public void bareCommand_keepsTheExistingShape() {
        // No params → byte-identical to what the pre-guard callers sent.
        assertEquals("http://127.0.0.1:2323/?cmd=loadStartUrl&password=secret",
                FkbRest.buildUrl("127.0.0.1", 2323, "secret", "loadStartUrl", null));
    }

    @Test
    public void paramsAppearBetweenCommandAndPassword_inInsertionOrder() {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("key", "kioskMode");
        p.put("value", "true");
        assertEquals("http://127.0.0.1:2323/?cmd=setBooleanSetting"
                        + "&key=kioskMode&value=true&password=secret",
                FkbRest.buildUrl("127.0.0.1", 2323, "secret", "setBooleanSetting", p));
    }

    @Test
    public void typeJsonIsJustAParam_soDeviceInfoShapeIsUnchanged() {
        Map<String, String> p = new LinkedHashMap<>();
        p.put("type", "json");
        assertEquals("http://127.0.0.1:2323/?cmd=deviceInfo&type=json&password=secret",
                FkbRest.buildUrl("127.0.0.1", 2323, "secret", "deviceInfo", p));
    }

    @Test
    public void passwordAndParamValuesSurviveSpecialCharacters() throws Exception {
        // The live FKB password contains &, = and + — un-encoded, the & alone would
        // truncate the password and hand FKB a bogus extra parameter.
        String pw = "a&b=c+d e";
        Map<String, String> p = new LinkedHashMap<>();
        p.put("key", "startURL");
        p.put("value", "https://host/x?a=1&b=2");
        String url = FkbRest.buildUrl("127.0.0.1", 2323, pw, "setStringSetting", p);

        // Nothing raw leaked into the query string...
        String query = url.substring(url.indexOf('?') + 1);
        assertEquals("query must split into exactly cmd/key/value/password",
                4, query.split("&").length);

        // ...and every value decodes back to exactly what went in.
        Map<String, String> back = new LinkedHashMap<>();
        for (String pair : query.split("&")) {
            int eq = pair.indexOf('=');
            back.put(pair.substring(0, eq), URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
        }
        assertEquals("setStringSetting", back.get("cmd"));
        assertEquals("startURL", back.get("key"));
        assertEquals("https://host/x?a=1&b=2", back.get("value"));
        assertEquals(pw, back.get("password"));
    }

    @Test
    public void hostAndPortComeFromTheArguments() {
        String url = FkbRest.buildUrl("10.0.0.245", 2424, "", "screenOn", null);
        assertTrue(url, url.startsWith("http://10.0.0.245:2424/?cmd=screenOn"));
    }

    // --- listSettings JSON parsing (pure; no network) ---------------------

    @Test
    public void parseSettings_normalizesBooleansAndNumbersToStrings() {
        Map<String, String> m = FkbRest.parseSettings(
                "{\"kioskMode\":false,\"reloadPageFailure\":30,\"startURL\":\"https://x/\"}");
        assertEquals("false", m.get("kioskMode"));
        assertEquals("30", m.get("reloadPageFailure"));
        assertEquals("https://x/", m.get("startURL"));
    }

    @Test
    public void parseSettings_returnsEmptyOnNonJson() {
        // A wrong/missing password makes FKB serve an HTML login page. That must read
        // as "unknown" (empty), never as "every setting drifted".
        assertTrue(FkbRest.parseSettings("<html>login</html>").isEmpty());
        assertTrue(FkbRest.parseSettings("").isEmpty());
        assertTrue(FkbRest.parseSettings(null).isEmpty());
    }
}
