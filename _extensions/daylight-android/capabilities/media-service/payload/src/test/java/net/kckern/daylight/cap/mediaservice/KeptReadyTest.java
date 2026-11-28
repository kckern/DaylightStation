package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class KeptReadyTest {
    @Test public void onlyAReadyCollectionIsOnThePhone() throws Exception {
        List<JSONObject> index = Arrays.asList(
                new JSONObject().put("contentId", "plex:1").put("state", "ready"),
                new JSONObject().put("contentId", "plex:2").put("state", "downloading"),
                new JSONObject().put("contentId", "plex:3").put("state", "damaged"),
                new JSONObject().put("contentId", "plex:4").put("done", 3).put("total", 3),
                new JSONObject().put("contentId", "plex:5").put("done", 2).put("total", 3));
        assertTrue(KeptReady.ready(index, "plex:1"));
        assertFalse(KeptReady.ready(index, "plex:2"));
        assertFalse(KeptReady.ready(index, "plex:3"));
        assertTrue("an older index with no state: every track done", KeptReady.ready(index, "plex:4"));
        assertFalse(KeptReady.ready(index, "plex:5"));
        assertFalse(KeptReady.ready(index, "plex:9"));
    }
}
