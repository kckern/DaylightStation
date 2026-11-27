package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONObject;
import org.junit.Test;

/** Audit: the same search a moment later is answered from the last answer, for a minute. */
public class LookupMemoTest {
    @Test public void aSearchIsRememberedForAMinute() {
        MediaServiceCapability.LookupMemo m = new MediaServiceCapability.LookupMemo();
        m.put("paradise", new JSONObject(), 1_000);
        assertNotNull(m.get("paradise", 30_000));
        assertNull(m.get("paradise", 1_000 + MediaServiceCapability.LookupMemo.FRESH_MS + 1));
        assertNull(m.get("hamlet", 2_000));
        m.put("paradise", new JSONObject(), 5_000);
        assertNull("a clock set back", m.get("paradise", 4_000));
    }
}
