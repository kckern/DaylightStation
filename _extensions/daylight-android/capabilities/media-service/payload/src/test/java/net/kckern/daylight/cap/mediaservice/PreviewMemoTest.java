package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.junit.Test;

/** Audit H13: a keep right after its preview takes the list the preview resolved, once, while fresh. */
public class PreviewMemoTest {
    private static MediaServiceCapability.Resolved r() {
        return new MediaServiceCapability.Resolved("plex:1", "Paradise", null, new JSONArray(), false, "book");
    }

    @Test public void aKeepTakesItsPreviewOnceWhileFresh() {
        MediaServiceCapability.PreviewMemo m = new MediaServiceCapability.PreviewMemo();
        m.put("p:plex:9", r(), 1_000);
        assertNotNull(m.take("p:plex:9", 1_000 + 60_000));
        assertNull(m.take("p:plex:9", 1_000 + 60_000));
    }

    @Test public void anOldOrOtherPreviewIsResolvedAfresh() {
        MediaServiceCapability.PreviewMemo m = new MediaServiceCapability.PreviewMemo();
        m.put("p:plex:9", r(), 1_000);
        assertNull(m.take("p:plex:8", 2_000));
        assertNull(m.take("p:plex:9", 1_000 + MediaServiceCapability.PreviewMemo.FRESH_MS + 1));
        m.put("p:plex:9", r(), 5_000);
        assertNull(m.take("p:plex:9", 4_000));   // a clock set back
    }
}
