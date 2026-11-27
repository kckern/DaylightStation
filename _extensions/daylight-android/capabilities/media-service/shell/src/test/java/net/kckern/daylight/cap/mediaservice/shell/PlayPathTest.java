package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.*;

import net.kckern.daylight.api.PayloadStart;
import net.kckern.daylight.shellkit.NowPlayingNote;

import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/** Wave 3, the play path: one budget, first frames, screen memory, the picker's rows, the first tap, remote commands. */
public class PlayPathTest {
    private static final String PLAYING = "{\"ok\":true,\"status\":200,\"snapshot\":{\"state\":\"playing\","
            + "\"currentItem\":{\"contentId\":\"plex:9\",\"title\":\"Morning Song\",\"thumbnail\":\"https://home.example/t.jpg\",\"duration\":200},"
            + "\"position\":30,\"queue\":{\"currentIndex\":0,\"items\":[{\"queueItemId\":\"q1\",\"contentId\":\"plex:9\",\"title\":\"Morning Song\"}]},"
            + "\"config\":{\"shuffle\":true,\"repeat\":\"all\",\"volume\":40}}}";

    // ── one budget ───────────────────────────────────────────────────────────

    @Test public void oneBudgetCoversTheResolveAndAColdPayload() {
        assertEquals(PlayBudget.RESOLVE_MS + PlayBudget.SOUND_MS, PlayBudget.giveUpMs(true));
        assertEquals(PlayBudget.giveUpMs(true) + PayloadStart.WAIT_MS, PlayBudget.giveUpMs(false));
        assertEquals("Starting's default is the warm budget", PlayBudget.WARM_MS, Starting.GIVE_UP_MS);
        assertEquals(PlayBudget.WARM_MS, PlayStart.GIVE_UP_MS);
        assertEquals(400, PlayBudget.left(1_000, 1_000, 1_600));
        assertEquals(0, PlayBudget.left(1_000, 1_000, 9_000));
    }

    @Test public void aStartingStateEndsOnItsOwnBudget() {
        Starting s = new Starting("local", "c:plex:1", "Mix", "", "", 0);
        s.giveUpMs = PlayBudget.giveUpMs(false);
        assertEquals(Starting.Phase.SLOW, s.phase(PlayBudget.WARM_MS));
        assertEquals("a cold payload has its own wait on top", Starting.Phase.FAILED, s.phase(PlayBudget.giveUpMs(false)));
    }

    @Test public void aWidgetAttemptUsesItsBudgetAndNamesItsPlaylist() {
        PlayStart.Attempt a = new PlayStart.Attempt("c:plex:1", 0, true, 50_000);
        assertTrue(a.canApply(49_999));
        assertFalse(a.canApply(50_000));
        assertEquals(PlayStart.Step.WAIT, PlayStart.next(40_000, 50_000, false, false, false, false));
        assertEquals(PlayStart.Step.FAIL, PlayStart.next(50_000, 50_000, false, false, false, false));
        assertEquals("Starting Morning Mix…", PlayStart.notice("Morning Mix"));
        assertEquals("Starting playback", PlayStart.notice(""));
        assertEquals("Could not start Morning Mix. Tap the button again to retry.", PlayStart.failure("Morning Mix"));
        assertEquals("Morning Mix", PlayStart.title("{\"ok\":true,\"mediaId\":\"p:plex:1\",\"title\":\"Morning Mix\"}"));
        assertEquals("", PlayStart.title("{\"ok\":true}"));
        assertEquals("", PlayStart.title("nope"));
    }

    // ── what a screen is asked to load ──────────────────────────────────────

    @Test public void aMediaIdBecomesAScreenLoad() {
        assertArrayEquals(new String[] { "queue", "plex:5" }, Starting.screenLoad("c:plex:5"));
        assertArrayEquals(new String[] { "play", "plex:7" }, Starting.screenLoad("p:plex:7|plex:5"));
        assertArrayEquals(new String[] { "play", "plex:7" }, Starting.screenLoad("p:plex:7"));
        assertNull(Starting.screenLoad("root"));
        assertNull(Starting.screenLoad("c:"));
        assertNull(Starting.screenLoad(null));
    }

    @Test public void theControllersOwnRequestIsNotTheItem() {
        assertTrue(NowPlayingActivity.isRequest("c:plex:5"));
        assertTrue(NowPlayingActivity.isRequest("p:plex:7|plex:5"));
        assertFalse("a played item has a content id", NowPlayingActivity.isRequest("plex:7"));
        assertFalse(NowPlayingActivity.isRequest(null));
    }

    @Test public void aStartWithNoTitleSaysSoPlainly() {
        Starting s = new Starting("local", "p:plex:1", "", "", "", 0);
        s.fail();
        assertEquals("Couldn't start it · tap to try again", s.failedLine(""));
    }

    // ── first frames ─────────────────────────────────────────────────────────

    @Test public void theMiniPlayersEntrySeedsOnlyItsOwnTarget() {
        NowPlayingNote.Entry e = new NowPlayingNote.Entry("local", "This phone", "Song", "Band", "https://a/b.jpg",
                true, true, 10_000, 100_000, 1_000, null);
        FirstFrame f = FirstFrame.seed(e, "local");
        assertNotNull(f);
        assertEquals("Connecting…", f.line(""));
        assertEquals("carried forward while connecting", 12_000, f.positionAt(3_000));
        assertEquals(0.12f, f.fractionAt(3_000), 0.0001f);
        assertNull("another target", FirstFrame.seed(e, "office-tv"));
        assertNull("nothing", FirstFrame.seed(null, "local"));
        assertNull("an empty entry", FirstFrame.seed(new NowPlayingNote.Entry("local", "", "", "", "", false, false, 0, -1, 0, null), "local"));
    }

    @Test public void aLostPlayerKeepsTheLastFrameStill() {
        NowPlayingNote.Entry e = new NowPlayingNote.Entry("local", "This phone", "Song", "", "", true, false, 10_000, 100_000, 1_000, null);
        FirstFrame f = FirstFrame.lost(e);
        assertEquals("Reconnecting…", f.line(""));
        assertEquals("not carried forward: nobody knows it plays", 10_000, f.positionAt(60_000));
        assertNull(FirstFrame.lost(null));
    }

    @Test public void aScreensRememberedAnswerIsAFrame() throws Exception {
        ScreenSnapshot snap = ScreenSnapshot.parse(new JSONObject(PLAYING));
        FirstFrame f = FirstFrame.screen(snap, "office-tv", 5_000);
        assertEquals("Morning Song", f.entry.title);
        assertEquals("https://home.example/t.jpg", f.entry.artworkUrl);
        assertTrue(f.entry.playing);
        assertEquals("Checking Office…", f.line("Office"));
        assertNull("idle shows nothing to seed", FirstFrame.screen(ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":204}")), "x", 0));
    }

    // ── screen memory ───────────────────────────────────────────────────────

    @Test public void aScreensAnswerIsKeptWithItsTimeAndAgesOut() throws Exception {
        JSONObject reply = new JSONObject(PLAYING);
        ScreenMemory.Record r = ScreenMemory.decode(ScreenMemory.encode(reply, 1_000_000));
        assertEquals(1_000_000, r.at);
        assertEquals("Morning Song", r.snapshot().currentEntry().title);
        assertEquals("read 4 s ago on the elapsed clock", 6_000, r.elapsedAt(1_004_000, 10_000));
        assertTrue(ScreenMemory.fresh(1_000_000, 1_000_000 + ScreenMemory.KEEP_MS - 1));
        assertFalse(ScreenMemory.fresh(1_000_000, 1_000_000 + ScreenMemory.KEEP_MS));
        assertFalse("a clock that moved back", ScreenMemory.fresh(1_000_000 + 120_000, 1_000_000));
        assertNull(ScreenMemory.decode("not json"));
        assertNull(ScreenMemory.decode(null));
        assertTrue(ScreenMemory.worthKeeping(reply));
        assertFalse("can't reach home says nothing of the screen", ScreenMemory.worthKeeping(new JSONObject("{\"ok\":false}")));
        assertTrue("off is an answer about the screen", ScreenMemory.worthKeeping(new JSONObject("{\"ok\":true,\"status\":503}")));
    }

    // ── the picker's rows ───────────────────────────────────────────────────

    @Test public void aTapOnACheckingRowWaitsForItsAnswer() throws Exception {
        PickRow row = new PickRow(false, false);
        assertTrue(row.checking());
        assertEquals(PickRow.Tap.WAIT, row.tap());
        assertEquals("on screen: picked when it answers", PickRow.Answer.PICK, row.answer(ScreenSnapshot.parse(new JSONObject(PLAYING))));
        assertEquals(PickRow.Tap.PICK, row.tap());
    }

    @Test public void aWaitingTapOnAnOffScreenGreysIt() throws Exception {
        PickRow row = new PickRow(false, false);
        row.tap();
        assertEquals(PickRow.Answer.DISABLE, row.answer(ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":503}"))));
        assertEquals(PickRow.Tap.IGNORE, row.tap());
        PickRow current = new PickRow(false, true);
        assertEquals("the one in use stays pickable", PickRow.Answer.SHOW,
                current.answer(ScreenSnapshot.parse(new JSONObject("{\"ok\":true,\"status\":503}"))));
        assertEquals(PickRow.Tap.PICK, new PickRow(true, false).tap());
    }

    @Test public void theHomesCachedScreensBecomeRows() {
        List<TargetPicker.Target> t = NowPlayingActivity.cachedScreens("[{\"id\":\"office-tv\",\"name\":\"Office\",\"type\":\"linux-pc\"},{\"name\":\"no id\"}]");
        assertEquals(1, t.size());
        assertEquals("Office", t.get(0).name);
        assertTrue(NowPlayingActivity.cachedScreens("").isEmpty());
        assertTrue(NowPlayingActivity.cachedScreens("{bad").isEmpty());
    }

    // ── the first tap on a list ─────────────────────────────────────────────

    @Test public void onlyATrackInItsListIsRaced() {
        assertTrue(FirstTap.races(Collections.singletonList("p:plex:7|plex:5"), Collections.singletonList(null), -1));
        assertFalse("no list", FirstTap.races(Collections.singletonList("p:plex:7"), null, -1));
        assertFalse("a list itself", FirstTap.races(Collections.singletonList("c:plex:5"), null, -1));
        assertFalse("a place asked for", FirstTap.races(Collections.singletonList("p:plex:7|plex:5"), null, 5_000));
        assertFalse("two ids", FirstTap.races(Arrays.asList("p:a|b", "p:c|b"), null, -1));
        assertFalse("a search", FirstTap.races(Collections.singletonList("p:a|b"), Collections.singletonList("words"), -1));
        assertEquals("p:plex:7", FirstTap.alone("p:plex:7|plex:5"));
    }

    @Test public void onlyMusicPlaysAloneFirst() {
        assertTrue(FirstTap.playsAlone(1, 200_000, 0));
        assertFalse("a book part", FirstTap.playsAlone(1, FirstTap.LONG_MS, 0));
        assertFalse("a place", FirstTap.playsAlone(1, 200_000, 30_000));
        assertFalse("length unknown", FirstTap.playsAlone(1, 0, 0));
        assertFalse("not one track", FirstTap.playsAlone(3, 200_000, 0));
    }

    @Test public void theTrackAloneFirstPlaysThenTheListIsSpliced() {
        FirstTap t = new FirstTap();
        assertEquals(FirstTap.Use.SINGLE, t.single(true, true));
        assertEquals(FirstTap.Use.SPLICE, t.full(true));
    }

    @Test public void theListFirstPlaysAndTheTrackAloneIsDropped() {
        FirstTap t = new FirstTap();
        assertEquals(FirstTap.Use.FULL, t.full(true));
        assertEquals(FirstTap.Use.NONE, t.single(true, true));
    }

    @Test public void aBookPartWaitsForTheListAndFallsBackToItself() {
        FirstTap t = new FirstTap();
        assertEquals(FirstTap.Use.WAIT, t.single(true, false));
        assertEquals("its place comes from the list", FirstTap.Use.FULL, t.full(true));
        FirstTap u = new FirstTap();
        assertEquals(FirstTap.Use.WAIT, u.single(true, false));
        assertEquals("the list failed: the part alone", FirstTap.Use.SINGLE, u.full(false));
    }

    @Test public void bothFailingFailsOnceAndAFailedListWaitsForTheTrack() {
        FirstTap t = new FirstTap();
        assertEquals(FirstTap.Use.WAIT, t.full(false));
        assertEquals(FirstTap.Use.FAIL, t.single(false, false));
        FirstTap u = new FirstTap();
        assertEquals(FirstTap.Use.WAIT, u.full(false));
        assertEquals(FirstTap.Use.SINGLE, u.single(true, true));
        FirstTap v = new FirstTap();
        assertEquals(FirstTap.Use.SINGLE, v.single(true, true));
        assertEquals("a failed list after the track: nothing to add", FirstTap.Use.NONE, v.full(false));
    }

    @Test public void theSpliceFindsThePlayingTrack() {
        List<String> ids = Arrays.asList("plex:1", "plex:2", "plex:3");
        assertEquals(1, FirstTap.spliceAt(ids, 1, "plex:2"));
        assertEquals("the list's start is another track: found by id", 2, FirstTap.spliceAt(ids, 0, "plex:3"));
        assertEquals(-1, FirstTap.spliceAt(ids, 0, "plex:9"));
        assertEquals(-1, FirstTap.spliceAt(null, 0, "plex:1"));
    }

    // ── a command to a screen settles on the screen's answer ────────────────

    @Test public void aPauseHoldsUntilTheScreenSaysPausedOrTheDeadline() throws Exception {
        CommandSettle pause = CommandSettle.of(ScreenCommands.playWhenReady("office-tv", false));
        ScreenSnapshot stillPlaying = ScreenSnapshot.parse(new JSONObject(PLAYING));
        ScreenSnapshot paused = ScreenSnapshot.parse(new JSONObject(PLAYING.replace("\"state\":\"playing\"", "\"state\":\"paused\"")));
        assertTrue(pause.again(stillPlaying, 100));
        assertFalse("out of time: settle on what it said", pause.again(stillPlaying, CommandSettle.HOLD_MS));
        assertFalse(pause.again(paused, 100));
    }

    @Test public void eachSettingSettlesOnItsOwnField() throws Exception {
        ScreenSnapshot s = ScreenSnapshot.parse(new JSONObject(PLAYING));
        assertTrue(CommandSettle.of(ScreenCommands.shuffle("x", true)).met(s));
        assertFalse(CommandSettle.of(ScreenCommands.shuffle("x", false)).met(s));
        assertTrue(CommandSettle.of(ScreenCommands.repeat("x", androidx.media3.common.Player.REPEAT_MODE_ALL)).met(s));
        assertTrue(CommandSettle.of(ScreenCommands.volume("x", 40)).met(s));
        assertFalse(CommandSettle.of(ScreenCommands.volume("x", 45)).met(s));
        assertTrue("a skip settles on the first read", CommandSettle.of(ScreenCommands.seek("x", Collections.singletonList("q1"), 0, 1, 0,
                androidx.media3.common.Player.COMMAND_SEEK_TO_NEXT)).met(s));
        assertFalse("a failed read is not the answer", CommandSettle.of(ScreenCommands.shuffle("x", true)).met(ScreenSnapshot.unreachable()));
    }
}
