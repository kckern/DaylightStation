package net.kckern.daylight.cap.bookmarks;

import static org.junit.Assert.*;

import net.kckern.daylight.core.CoreRuntime;
import net.kckern.daylight.core.backend.Backend;
import net.kckern.daylight.core.spi.LinkHandler;
import net.kckern.daylight.core.spi.PageOpener;
import net.kckern.daylight.core.testing.FakeContext;
import net.kckern.daylight.core.testing.FakeShell;
import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class BookmarksCapabilityTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private CoreRuntime core;
    private BookmarksCapability cap;
    private final List<String> loaded = new ArrayList<>();
    private final List<String> outside = new ArrayList<>();
    private final PageOpener opener = new PageOpener() {
        @Override public String open(String url) { loaded.add(url); return "loading"; }
        @Override public String openFromOutside(String url) { outside.add(url); return "loading"; }
    };

    @Before public void setUp() throws Exception {
        core = TestCore.create(tmp.newFolder());
        cap = new BookmarksCapability();
        core.add(cap);
        core.prepare(new JSONObject());
        core.services().provide(PageOpener.class, opener);
        core.settings().set(Backend.BASE_URL, "https://kiosk.example:3111");
        core.settings().set("bookmarks.1", "feed|Feed|open|/feed");
    }

    @After public void tearDown() { TestCore.releaseMainThread(); }

    private LinkHandler handler(String kind) {
        for (LinkHandler h : core.services().all(LinkHandler.class)) if (kind.equals(h.kind())) return h;
        throw new AssertionError("no handler for " + kind);
    }

    private static Map<String, String> path(String path) {
        Map<String, String> q = new HashMap<>();
        q.put("path", path);
        return q;
    }

    @Test public void phoneHomeCanSaveOpenAndRemoveAHouseholdPage() throws Exception {
        cap.start();
        net.kckern.daylight.api.PayloadPort port = net.kckern.daylight.api.PayloadPort.named("phone-bookmarks");
        try {
            port.call(new JSONObject().put("op", "save").put("label", "Progress")
                    .put("path", "https://kiosk.example:3111/health/progress").toString(), 0);
            JSONObject item = new JSONObject(port.call("{\"op\":\"list\"}", 0))
                    .getJSONArray("items").getJSONObject(1);
            assertEquals("/health/progress", item.getString("path"));
            String id = item.getString("id");
            port.call(new JSONObject().put("op", "open").put("id", id).toString(), 0);
            assertEquals("https://kiosk.example:3111/health/progress", loaded.get(0));
            port.call(new JSONObject().put("op", "remove").put("id", id).toString(), 0);
            assertEquals(1, new JSONObject(port.call("{\"op\":\"list\"}", 0)).getJSONArray("items").length());
        } finally { cap.stop(); }
    }

    @Test public void listsBookmarksWithTheirLinks() throws Exception {
        JSONObject first = TestCore.get(core, "/bookmarks").getJSONArray("bookmarks").getJSONObject(0);
        assertEquals("feed", first.getString("id"));
        assertEquals("Feed", first.getString("label"));
        assertEquals("/feed", first.getString("path"));
        assertEquals("daylight://bookmark/feed", first.getString("uri"));
    }

    @Test public void openingAPathLoadsItAndBringsTheAppForward() throws Exception {
        JSONObject r = handler("open").handle("", path("/media/channels?tab=recent"));
        assertTrue(r.getBoolean("ok"));
        assertEquals("front", r.getString("effect"));
        assertEquals("[https://kiosk.example:3111/media/channels?tab=recent]", loaded.toString());
    }

    // ── a link without the install key: any app or web page can send one ─────

    @Test public void anUnkeyedOpenLinkOpensOnlyAConfiguredBookmarksPath() throws Exception {
        JSONObject r = handler("open").handle("", path("/feed"), false);
        assertEquals("front", r.getString("effect"));
        assertEquals("told to the page as a load from outside the app", "[https://kiosk.example:3111/feed]", outside.toString());
        assertTrue(loaded.isEmpty());
        for (String other : new String[] { "/media", "/feed?tab=1", "/feed#x", "/feed/", "/Feed", "/feed/more", "/" }) {
            try { handler("open").handle("", path(other), false); fail("opened " + other + " without the key"); }
            catch (IllegalArgumentException expected) { }
        }
        assertEquals(1, outside.size());
        assertTrue(loaded.isEmpty());
    }

    @Test public void aKeyedOpenLinkOpensAnyPageOfTheSite() throws Exception {
        handler("open").handle("", path("/media/channels?tab=recent"), true);
        assertEquals("[https://kiosk.example:3111/media/channels?tab=recent]", loaded.toString());
        assertTrue(outside.isEmpty());
    }

    @Test public void anUnkeyedBookmarkLinkIsALoadFromOutsideAndAKeyedOneIsNot() throws Exception {
        handler("bookmark").handle("feed", Collections.<String, String>emptyMap(), false);
        assertEquals("[https://kiosk.example:3111/feed]", outside.toString());
        handler("bookmark").handle("feed", Collections.<String, String>emptyMap(), true);
        assertEquals("[https://kiosk.example:3111/feed]", loaded.toString());
    }

    @Test public void aCallFromInsideTheAppIsNotALinkFromOutside() throws Exception {
        // What a one-tap action does once its own keyed link was accepted.
        handler("bookmark").handle("feed", Collections.<String, String>emptyMap());
        handler("open").handle("", path("/media"));
        assertEquals(2, loaded.size());
        assertTrue(outside.isEmpty());
    }

    @Test public void aPathThatLeavesTheSiteOrReachesTheApiIsRefused() throws Exception {
        for (String bad : new String[] { "//evil.example/", "https://evil.example/", "media", "", "/api/v1/home/scenes/all-off",
                "/API/v1/x", "/x/../api/v1/x", "/%61pi/x", "javascript:alert(1)", "/\\evil.example" }) {
            try { handler("open").handle("", path(bad)); fail("accepted " + bad); } catch (IllegalArgumentException expected) { }
        }
        try { handler("open").handle("", Collections.<String, String>emptyMap()); fail("accepted no path"); }
        catch (IllegalArgumentException expected) { }
        assertTrue(loaded.isEmpty());
    }

    @Test public void opensABookmarkByIdAndRefusesAnUnknownOne() throws Exception {
        assertEquals("front", handler("bookmark").handle("feed", Collections.<String, String>emptyMap()).getString("effect"));
        assertEquals("https://kiosk.example:3111/feed", loaded.get(0));
        try { handler("bookmark").handle("nope", Collections.<String, String>emptyMap()); fail("opened an unknown bookmark"); }
        catch (IllegalArgumentException expected) { }
        assertEquals(1, loaded.size());
    }

    @Test public void aBookmarkLinkCannotCarryItsOwnPath() throws Exception {
        // The id picks a configured bookmark. Nothing in the link's query changes where it goes.
        handler("bookmark").handle("feed", path("/api/v1/x"));
        assertEquals("[https://kiosk.example:3111/feed]", loaded.toString());
    }

    @Test public void aMalformedBookmarkIsRefusedWhenItIsSet() throws Exception {
        try {
            core.settings().set("bookmarks.2", "broken line");
            fail("accepted a malformed bookmark");
        } catch (RuntimeException e) {
            assertTrue(e.getMessage(), e.getMessage().contains("expected id|label|icon|path"));
        }
        JSONObject r = TestCore.call(core, "POST", "/settings", null, "{\"key\":\"bookmarks.2\",\"value\":\"x|X|open|/api/v1/x\"}");
        assertEquals(400, r.getInt("_status"));
    }

    @Test public void aDuplicateIdIsSkippedAndReportedAndStartDoesNotThrow() throws Exception {
        core.settings().set("bookmarks.2", "feed|Feed again|open|/feed2");
        cap.start();
        cap.stop();
        JSONObject list = TestCore.get(core, "/bookmarks");
        assertEquals(1, list.getJSONArray("bookmarks").length());
        assertTrue(list.getJSONArray("problems").getString(0).contains("used twice"));
        assertTrue(((FakeShell) core.shell()).notes.toString().contains("used twice"));
    }

    @Test public void withNoPageToShowItInTheLinkSaysSo() throws Exception {
        CoreRuntime bare = TestCore.create(tmp.newFolder());
        bare.add(new BookmarksCapability());
        bare.prepare(new JSONObject());
        bare.settings().set(Backend.BASE_URL, "https://kiosk.example");
        JSONObject r = bare.services().all(LinkHandler.class).get(0).handle("", path("/feed"));
        assertEquals("toast", r.getString("effect"));
        assertEquals("Not available on this device", r.getString("message"));
    }

    @Test public void withNoBackendConfiguredTheLinkIsRefusedWithAReason() throws Exception {
        core.settings().reset(Backend.BASE_URL);
        JSONObject r = handler("open").handle("", path("/feed"));
        assertFalse(r.getBoolean("ok"));
        assertEquals("not_configured", r.getString("error"));
        assertTrue(loaded.isEmpty());
    }

    @Test public void aRealStartTakesNothingAndStopTwiceIsSafe() throws Exception {
        FakeContext context = new FakeContext(tmp.newFolder());
        CoreRuntime real = TestCore.createWithContext(tmp.newFolder(), context);
        BookmarksCapability started = new BookmarksCapability();
        real.add(started);
        real.prepare(new JSONObject());
        started.start();
        assertEquals(0, context.registered);
        started.stop();
        started.stop();
        assertTrue(context.receivers.isEmpty());
    }

    @Test public void namesItself() {
        assertEquals("bookmarks", cap.name());
    }
}
