package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import net.kckern.daylight.core.backend.Http;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The phone's inbox: a command becomes a play or a keep here, every command is
 * acknowledged with this install's id, a command for another install is never applied,
 * and the poll carries this install and its token.
 */
public class PlayInboxTest {
    private static final String ME = "11111111-2222-3333-4444-555555555555";
    private final List<String> posts = new ArrayList<>();
    private final List<String> played = new ArrayList<>();
    private final List<String> kept = new ArrayList<>();
    private final List<Map<String, String>> sentHeaders = new ArrayList<>();
    private final List<String> polled = new ArrayList<>();
    private int pollStatus = 204;
    private String pollBody = "";
    private final List<Boolean> reached = new ArrayList<>();
    private final long[] now = { 1_000_000 };

    private PlayInbox inbox(boolean playerThere) {
        return inbox(playerThere, "tok-1");
    }

    private PlayInbox inbox(boolean playerThere, String token) {
        Http http = new Http() {
            @Override public Reply get(String url) { throw new AssertionError("a poll carries its headers"); }
            @Override public Reply get(String url, Map<String, String> headers) {
                polled.add(url);
                sentHeaders.add(new HashMap<>(headers));
                return new Reply(pollStatus, pollBody);
            }
            @Override public Reply postJson(String url, String json) { throw new AssertionError("a post carries its headers"); }
            @Override public Reply postJson(String url, String json, Map<String, String> headers) {
                posts.add(url + " " + json);
                sentHeaders.add(new HashMap<>(headers));
                return new Reply(204, "");
            }
            @Override public Reply postFile(String url, String contentType, File file, Map<String, String> headers) { throw new AssertionError(); }
        };
        return new PlayInbox(http, path -> "https://home.example" + path, "phone", ME, "SM-S921U", () -> token, id -> {
            if (!playerThere) throw new IllegalStateException("no player");
            played.add(id);
        }, new PlayInbox.Keeper() {
            @Override public void keep(String contentId, String title) throws Exception {
                if (contentId.equals("plex:404")) throw new IllegalStateException("not_found");
                kept.add("keep " + contentId);
            }
            @Override public void unkeep(String contentId) { kept.add("unkeep " + contentId); }
        }, reached::add, ms -> { }, () -> now[0]);
    }

    private JSONObject ack(int i) throws Exception {
        return new JSONObject(posts.get(i).substring(posts.get(i).indexOf('{')));
    }

    @Test public void theWebsQueueEnvelopeStartsThroughTheQueueRoute() throws Exception {
        JSONObject envelope = new JSONObject().put("commandId", "d-9").put("command", "queue").put("targetDevice", "phone")
                .put("params", new JSONObject().put("op", "play-now").put("contentId", "plex:352336"));
        assertEquals("c:plex:352336", PlayInbox.mediaIdOf(envelope));
        assertEquals("c:plex:727120", PlayInbox.mediaIdOf(new JSONObject().put("contentId", "plex:727120")));
        assertNull(PlayInbox.mediaIdOf(new JSONObject().put("params", new JSONObject().put("contentId", "../etc"))));
    }

    @Test public void aCommandPlaysHereAndIsAcknowledgedWithThisInstall() throws Exception {
        inbox(true).handle(new JSONObject().put("commandId", "d-1").put("command", "queue").put("installId", ME)
                .put("params", new JSONObject().put("op", "play-now").put("contentId", "plex:352336")));
        assertEquals(List.of("c:plex:352336"), played);
        assertTrue(posts.get(0).startsWith("https://home.example/api/v1/device/phone/ack {"));
        JSONObject ack = ack(0);
        assertEquals("d-1", ack.getString("commandId"));
        assertTrue(ack.getBoolean("ok"));
        assertEquals(ME, ack.getString("installId"));
        assertEquals("plex:352336", ack.getJSONObject("state").getString("contentId"));
        assertEquals("Bearer tok-1", sentHeaders.get(0).get("Authorization"));
    }

    /** The emulator, a reinstall or a second phone never acts on a command meant for another install. */
    @Test public void aCommandForAnotherInstallIsNeverApplied() throws Exception {
        inbox(true).handle(new JSONObject().put("commandId", "d-5").put("contentId", "plex:1")
                .put("installId", "99999999-2222-3333-4444-555555555555"));
        inbox(true).handle(new JSONObject().put("commandId", "d-6").put("command", "keep").put("contentId", "plex:2")
                .put("installId", "99999999-2222-3333-4444-555555555555"));
        assertTrue(played.isEmpty());
        assertTrue(kept.isEmpty());
        assertEquals("wrong_install", ack(0).getString("error"));
        assertEquals("wrong_install", ack(1).getString("error"));
    }

    @Test public void keepAndUnkeepCommandsGoToTheKeeperAndAreAcknowledgedAsSuch() throws Exception {
        PlayInbox inbox = inbox(true);
        inbox.handle(new JSONObject().put("commandId", "k-1").put("command", "keep").put("contentId", "plex:440630").put("title", "4th"));
        inbox.handle(new JSONObject().put("commandId", "k-2").put("command", "unkeep").put("contentId", "plex:440630"));
        inbox.handle(new JSONObject().put("commandId", "k-3").put("command", "keep").put("contentId", "plex:404"));
        assertEquals(List.of("keep plex:440630", "unkeep plex:440630"), kept);
        assertTrue(played.isEmpty());
        assertEquals("keep", ack(0).getString("appliedAs"));
        assertFalse(ack(0).has("state"));
        assertEquals("unkeep", ack(1).getString("appliedAs"));
        assertFalse(ack(2).getBoolean("ok"));
        assertEquals("not_found", ack(2).getString("error"));
    }

    @Test public void aRefusedCommandIsAcknowledgedAsRefused() throws Exception {
        inbox(false).handle(new JSONObject().put("commandId", "d-2").put("op", "play").put("contentId", "plex:1"));
        assertFalse(ack(0).getBoolean("ok"));
        assertEquals("could_not_play", ack(0).getString("error"));
        inbox(true).handle(new JSONObject().put("commandId", "d-3").put("op", "seek"));
        assertEquals("unsupported", ack(1).getString("error"));
    }

    @Test public void thePollNamesThisInstallItsModelAndCarriesTheToken() throws Exception {
        PlayInbox inbox = inbox(true);
        pollStatus = 200;
        pollBody = new JSONObject().put("commands", new JSONArray().put(new JSONObject().put("commandId", "c-1")
                .put("contentId", "plex:5").put("installId", ME))).toString();
        inbox.pollOnce();
        assertEquals("https://home.example/api/v1/device/phone/commands?wait=20&installId=" + ME + "&model=SM-S921U", polled.get(0));
        assertEquals("Bearer tok-1", sentHeaders.get(0).get("Authorization"));
        assertEquals(List.of("c:plex:5"), played);
        assertEquals(List.of(true), reached);
    }

    @Test public void noTokenSendsNoAuthorizationAndARefusalIsUnauthorized() throws Exception {
        PlayInbox inbox = inbox(true, "");
        pollStatus = 401;
        try { inbox.pollOnce(); fail("401 is unauthorized"); } catch (PlayInbox.Unauthorized expected) { }
        assertFalse(sentHeaders.get(0).containsKey("Authorization"));
        assertTrue("a refused token is not 'home is down'", reached.isEmpty());
    }

    @Test public void theKeptListIsSentWholeOnTheNextPollAndOnlyOnce() throws Exception {
        PlayInbox inbox = inbox(true);
        inbox.reportKeeps(new JSONArray().put(new JSONObject().put("contentId", "plex:9").put("state", "downloading").put("done", 1).put("total", 3)));
        inbox.pollOnce();   // changed under 5 s ago: not yet
        now[0] += 5_000;
        inbox.pollOnce();   // still for 5 s: sent
        now[0] += 20_000;
        inbox.pollOnce();   // unchanged, under a minute: not again
        List<String> keeps = new ArrayList<>();
        for (String p : posts) if (p.startsWith("https://home.example/api/v1/device/phone/keeps ")) keeps.add(p);
        assertEquals(1, keeps.size());
        JSONObject body = new JSONObject(keeps.get(0).substring(keeps.get(0).indexOf('{')));
        assertEquals(ME, body.getString("installId"));
        assertEquals("downloading", body.getJSONArray("items").getJSONObject(0).getString("state"));
    }

    @Test public void anEmulatorPollsAsItsOwnDeviceAndNeverAsThePhone() {
        assertTrue(InboxIdentity.emulator("google/sdk_gphone64_arm64/emu64a:14/UE1A/1:userdebug/dev-keys", "ranchu", "sdk_gphone64_arm64", "sdk_gphone64_arm64"));
        assertFalse(InboxIdentity.emulator("samsung/e1qsqw/e1q:16/BP2A/S921USQS:user/release-keys", "qcom", "e1qsqw", "SM-S921U"));
        assertEquals("phone-emulator", InboxIdentity.inboxDeviceId("phone", true));
        assertEquals("phone", InboxIdentity.inboxDeviceId("phone", false));
        assertTrue(PlayInbox.validDevice("phone-emulator"));
    }

    @Test public void theInstallIdIsMadeOnceAndKept() throws Exception {
        File dir = java.nio.file.Files.createTempDirectory("inbox").toFile();
        String a = InboxIdentity.installId(dir), b = InboxIdentity.installId(dir);
        assertEquals(a, b);
        assertTrue(InboxIdentity.INSTALL.matcher(a).matches());
        File other = java.nio.file.Files.createTempDirectory("inbox2").toFile();
        assertFalse("a reinstall (a cleared state) is a new install", a.equals(InboxIdentity.installId(other)));
    }

    @Test public void theKeptListIsSentAgainAtMostOnceAMinuteAndAChangeAfterFiveSeconds() {
        assertFalse(PlayInbox.keepsDue(true, 1_000, 0, 5_999, true));
        assertTrue(PlayInbox.keepsDue(true, 1_000, 0, 6_000, true));
        assertFalse("not twice in 5 s", PlayInbox.keepsDue(true, 1_000, 4_000, 6_000, true));
        assertFalse(PlayInbox.keepsDue(false, 0, 10_000, 69_999, true));
        assertTrue(PlayInbox.keepsDue(false, 0, 10_000, 70_000, true));
        assertFalse("nothing to say before the first list", PlayInbox.keepsDue(false, 0, 0, 999_999, false));
    }

    @Test public void aRefusedTokenSaysWhyAndNeverTheToken() throws Exception {
        PlayInbox inbox = inbox(true, "secret-token");
        pollStatus = 401;
        pollBody = "{\"code\":\"UNAUTHORIZED\",\"details\":[\"wrong_token\"]}";
        try { inbox.pollOnce(); fail(); } catch (PlayInbox.Unauthorized expected) { }
        assertEquals("", PlayInbox.reasonOf("{\"details\":[\"Bearer abc.def\"]}"));
        assertEquals("wrong_token", PlayInbox.reasonOf(pollBody));
        assertFalse(inbox.status().contains("secret"));
    }

    /** An emulator polls as phone-emulator; a backend without that inbox answers 404: home is not down. */
    @Test public void anInboxHomeDoesNotServeIsNotHomeDown() throws Exception {
        PlayInbox inbox = inbox(true);
        pollStatus = 404;
        try { inbox.pollOnce(); fail(); } catch (PlayInbox.NotServed expected) { }
        assertEquals(List.of(true), reached);
    }
}
