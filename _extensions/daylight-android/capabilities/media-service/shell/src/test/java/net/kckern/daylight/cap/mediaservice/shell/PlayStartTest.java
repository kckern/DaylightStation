package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.cap.mediaservice.shell.PlayStart.Step;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Test;

public class PlayStartTest {
    private PayloadPort.Handler handler;

    @After public void tearDown() {
        if (handler != null) PayloadPort.named(PayloadMedia.PORT).detach(handler);
    }

    @Test public void theMediaIdIsTakenFromThePayloadsAnswerOnlyWhenItIsAnItemId() {
        assertEquals("p:plex:12345", PlayStart.mediaId("{\"ok\":true,\"mediaId\":\"p:plex:12345\"}"));
        for (String bad : new String[] { null, "", "not json", "{\"ok\":false,\"error\":\"unknown_action\"}",
                "{\"ok\":true}", "{\"ok\":true,\"mediaId\":\"https://kiosk.example/a.mp3\"}",
                "{\"ok\":true,\"mediaId\":\"c:plex:1\"}", "{\"ok\":true,\"mediaId\":\"root\"}", "{\"ok\":true,\"mediaId\":7}" }) {
            assertNull(String.valueOf(bad), PlayStart.mediaId(bad));
        }
    }

    @Test public void untilPlaybackStartsTheServiceWaitsAndThenGivesUp() {
        assertEquals(Step.WAIT, PlayStart.next(0, false, false, false, false));
        assertEquals(Step.WAIT, PlayStart.next(PlayStart.GIVE_UP_MS - 1, false, false, false, false));
        assertEquals(Step.FAIL, PlayStart.next(PlayStart.GIVE_UP_MS, false, false, false, false));
        assertEquals("a failure ends it at once", Step.FAIL, PlayStart.next(10, true, false, false, false));
    }

    /** Once playing, the media service carries the foreground state; this one lets go. */
    @Test public void onceTheMediaServiceIsInTheForegroundTheServiceLetsGo() {
        assertEquals(Step.RELEASE, PlayStart.next(2000, false, true, true, true));
    }

    /** Where Android refused the media service's own foreground start, this one holds it while the audio plays. */
    @Test public void whenTheMediaServiceCouldNotBecomeForegroundTheServiceHoldsItWhilePlaying() {
        assertEquals(Step.WAIT, PlayStart.next(2000, false, true, true, false));
        assertEquals(Step.WAIT, PlayStart.next(10 * 60_000, false, true, true, false));
        assertEquals("playback ended or paused", Step.RELEASE, PlayStart.next(10 * 60_000, false, true, false, false));
    }

    @Test public void theRequestNamesAnActionAndNothingElse() throws Exception {
        final String[] seen = new String[1];
        handler = request -> { seen[0] = request; return "{\"ok\":true,\"mediaId\":\"p:plex:1\"}"; };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
        new PayloadMedia().action("radio", 0);
        JSONObject r = new JSONObject(seen[0]);
        assertEquals("action", r.getString("op"));
        assertEquals("radio", r.getString("action"));
        assertEquals(2, r.length());
    }
}
