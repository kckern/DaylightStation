package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadPort;
import net.kckern.daylight.cap.mediaservice.shell.PlayStart.Step;

import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.session.MediaSession;

import com.google.common.util.concurrent.ListeningExecutorService;
import com.google.common.util.concurrent.MoreExecutors;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Arrays;
import org.junit.After;
import org.junit.Test;

public class PlayStartTest {
    private PayloadPort.Handler handler;

    @After public void tearDown() {
        if (handler != null) PayloadPort.named(PayloadMedia.PORT).detach(handler);
    }

    @Test public void eachAttemptOwnsItsPlaylistAndCanNoLongerStartAfterCancellation() {
        PlayStart.Attempt first = new PlayStart.Attempt("c:plex:first", 100);
        PlayStart.Attempt second = new PlayStart.Attempt("c:plex:second", 200);
        assertEquals("c:plex:first", first.playlist);
        assertEquals("c:plex:second", second.playlist);
        first.cancel();
        assertFalse(first.canApply(300));
        first.recordPlaying(300);
        assertFalse(first.played());
        assertTrue(second.canApply(300));
        assertFalse(second.canApply(200 + PlayStart.GIVE_UP_MS));
        second.recordPlaying(200 + PlayStart.GIVE_UP_MS);
        assertFalse(second.played());
        second.recordPlaying(200 + PlayStart.GIVE_UP_MS - 1);
        assertTrue(second.played());
    }

    @Test public void twoWidgetStartsResolveTheIdsOfTheirOwnPlaylists() throws Exception {
        java.util.List<String> resolved = new java.util.ArrayList<>();
        handler = raw -> {
            String id = new JSONObject(raw).getJSONArray("ids").getString(0);
            resolved.add(id);
            return new JSONObject().put("ok", true).put("tracks", new JSONArray().put(new JSONObject()
                    .put("id", id + "-song").put("url", "https://kiosk.example/track").put("listId", id))).toString();
        };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
        PayloadMedia media = new PayloadMedia();
        assertEquals("c:plex:first-song", media.resolveShortcut("c:plex:first", 0).tracks.get(0).id);
        assertEquals("c:plex:second-song", media.resolveShortcut("c:plex:second", 0).tracks.get(0).id);
        assertEquals(Arrays.asList("c:plex:first", "c:plex:second"), resolved);
    }

    @Test public void stationShuffleIsRequestedFromThePayloadAndPreservesItsFirstItem() throws Exception {
        handler = raw -> {
            JSONObject request = new JSONObject(raw);
            assertTrue(request.getBoolean("shuffle"));
            assertEquals("c:plex:757556", request.getJSONArray("ids").getString(0));
            JSONArray tracks = new JSONArray()
                    .put(new JSONObject().put("id", "plex:757863").put("url", "https://kiosk.example/ident"))
                    .put(new JSONObject().put("id", "plex:song").put("url", "https://kiosk.example/song"));
            return new JSONObject().put("ok", true).put("tracks", tracks).toString();
        };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
        assertEquals("plex:757863", new PayloadMedia().resolveShortcut("c:plex:757556", true, 0).tracks.get(0).id);
    }

    @Test public void stopFromStartingNoticeStopsThePreviousQueueAndCancelsThePendingQueue() {
        PlayStart.Attempt first = new PlayStart.Attempt("c:plex:first", 100);
        first.recordPlaying(110);
        PlayStart.Attempt second = new PlayStart.Attempt("c:plex:second", 120);
        PlayStart.Attempt[] audible = { first };

        PlayActionService.stopFromNotification(second::cancel, () -> {
            assertFalse("the pending queue is invalidated before clearing the player", second.canApply(130));
            audible[0] = null;
        });

        if (second.canApply(150)) audible[0] = second;
        assertNull("the previous queue is silent and the pending queue cannot replace it", audible[0]);
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

    @Test public void controllerStartUsesTheResolvedIndexAndExplicitOffset() throws Exception {
        assertStart(1, 1234, true, 2, 1234);
    }

    @Test public void explicitZeroOverridesTheSavedPosition() throws Exception {
        assertStart(1, 0, true, 2, 0);
        assertStart(C.INDEX_UNSET, 0, true, 1, 0);
    }

    @Test public void unsetOrInvalidControllerSelectionKeepsResolverDefaults() throws Exception {
        assertStart(C.INDEX_UNSET, C.TIME_UNSET, false, 1, 250_000);
        assertStart(9, C.TIME_UNSET, false, 1, 250_000);
        assertStart(9, 0, false, 1, 250_000);
    }

    @Test public void anEmptySelectionDoesNotSeekInTheFallbackTrack() throws Exception {
        assertStart(0, 1234, true, 1, 250_000);
    }

    private void assertStart(int index, long position, boolean explicit, int expectedIndex, long expectedPosition)
            throws Exception {
        if (handler != null) PayloadPort.named(PayloadMedia.PORT).detach(handler);
        handler = raw -> {
            JSONObject request = new JSONObject(raw);
            int selected = request.optInt("startIndex", C.INDEX_UNSET);
            assertEquals("explicit position", explicit, request.optBoolean("explicitPosition"));
            JSONObject track = new JSONObject().put("id", "plex:1").put("title", "Song").put("url", "https://kiosk.example/s");
            return new JSONObject().put("ok", true).put("startIndex", selected == 1 ? 2 : 1)
                    .put("startPositionMs", 250_000)
                    .put("selectionResolved", selected == 1 || (selected == C.INDEX_UNSET && explicit))
                    .put("tracks", new JSONArray().put(track).put(track).put(track)).toString();
        };
        PayloadPort.named(PayloadMedia.PORT).attach(handler);
        ListeningExecutorService executor = MoreExecutors.newDirectExecutorService();
        LibraryCallback callback = new LibraryCallback(new PayloadMedia(), executor, "test", null, () -> "", () -> {});
        MediaSession.MediaItemsWithStartPosition result = callback.onSetMediaItems(null, null,
                Arrays.asList(new MediaItem.Builder().setMediaId("c:plex:1").build(),
                        new MediaItem.Builder().setMediaId("p:plex:2").build()), index, position).get();
        assertEquals(expectedIndex, result.startIndex);
        assertEquals(expectedPosition, result.startPositionMs);
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
