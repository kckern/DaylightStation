package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class BrowseCacheTest {
    private final BrowseCache cache = new BrowseCache(3, 60_000);
    private int loads;
    private boolean down;

    private List<MediaNode> load(String key, long now) throws Exception {
        return cache.get(key, now, () -> {
            loads++;
            if (down) throw new IOException("no route to host");
            return Collections.singletonList(new MediaNode("c:plex:" + loads, "Loaded " + loads, "", null, true, false));
        });
    }

    @Test public void aFreshLevelIsServedWithoutAskingAgain() throws Exception {
        assertEquals("Loaded 1", load("recent", 0).get(0).title);
        assertEquals("Loaded 1", load("recent", 59_999).get(0).title);
        assertEquals(1, loads);
        assertEquals("after a minute it is asked for again", "Loaded 2", load("recent", 60_000).get(0).title);
    }

    @Test public void whenTheBackendIsOutOfReachTheLastKnownLevelIsServed() throws Exception {
        load("recent", 0);
        down = true;
        assertEquals("Loaded 1", load("recent", 600_000).get(0).title);
        assertEquals("it was tried", 2, loads);
    }

    @Test public void withNothingKnownTheFailureIsTheAnswer() {
        down = true;
        try { load("recent", 0); fail("an empty shelf would look like an empty library"); }
        catch (Exception e) { assertTrue(e instanceof IOException); }
    }

    @Test public void itKeepsOnlyTheMostRecentlyUsedLevels() throws Exception {
        load("a", 0); load("b", 1); load("c", 2);
        load("a", 3);                    // a is used again, so b is now the oldest
        load("d", 4);                    // pushes b out
        down = true;
        assertNotNull(load("a", 700_000));
        try { load("b", 700_000); fail("b should have been dropped"); } catch (IOException expected) { }
        assertEquals(3, cache.size());
    }

    @Test public void whatIsHandedOutCannotChangeWhatIsKept() throws Exception {
        List<MediaNode> first = load("recent", 0);
        try { first.add(new MediaNode("c:x:1", "x", "", null, true, false)); } catch (UnsupportedOperationException fine) { }
        assertEquals(1, load("recent", 1).size());
        assertNotNull(new ArrayList<>(first));
    }

    /** R4: the kept list is read from the phone's own files, so a keep saved or removed shows at once, not a minute later. */
    @Test public void theKeptListIsNeverServedFromTheCache() {
        assertFalse(BrowseCache.cacheable(MediaId.Kind.KEPT));
        assertTrue(BrowseCache.cacheable(MediaId.Kind.CONTINUE));
        assertTrue(BrowseCache.cacheable(MediaId.Kind.RECENT));
        assertTrue(BrowseCache.cacheable(MediaId.Kind.CONTAINER));
    }
}
