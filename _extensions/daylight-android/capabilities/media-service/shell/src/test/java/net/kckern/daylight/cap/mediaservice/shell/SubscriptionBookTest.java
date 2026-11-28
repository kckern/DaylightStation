package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import org.junit.Test;

/** Who follows which parent: the legacy browsers Media3 1.1.1 does not reach by a broadcast. */
public class SubscriptionBookTest {
    @Test public void whoeverSubscribedIsListedForThatParentOnly() {
        SubscriptionBook<String> book = new SubscriptionBook<>();
        book.add("kept", "auto");
        book.add("root", "auto");
        book.add("kept", "other");
        assertEquals(new HashSet<>(Arrays.asList("auto", "other")), new HashSet<>(book.of("kept")));
        assertEquals(Collections.singletonList("auto"), book.of("root"));
        assertTrue(book.of("c:plex:1").isEmpty());
    }

    @Test public void unsubscribingOneParentLeavesTheRest() {
        SubscriptionBook<String> book = new SubscriptionBook<>();
        book.add("kept", "auto");
        book.add("root", "auto");
        book.remove("kept", "auto");
        assertTrue(book.of("kept").isEmpty());
        assertEquals(Collections.singletonList("auto"), book.of("root"));
    }

    @Test public void disconnectingDropsEveryParent() {
        SubscriptionBook<String> book = new SubscriptionBook<>();
        book.add("kept", "auto");
        book.add("root", "auto");
        book.add("root", "other");
        book.removeAll("auto");
        assertTrue(book.of("kept").isEmpty());
        assertEquals(Collections.singletonList("other"), book.of("root"));
    }

    /** A follower that is no longer connected is skipped and forgotten, whether or not onDisconnected ever ran. */
    @Test public void deliveryReachesConnectedFollowersAndForgetsTheRest() {
        SubscriptionBook<String> book = new SubscriptionBook<>();
        book.add("kept", "auto");
        book.add("kept", "gone");
        book.add("root", "gone");
        java.util.List<String> told = new java.util.ArrayList<>();
        book.deliver("kept", Arrays.asList("auto", "someone else"), told::add);
        assertEquals(Collections.singletonList("auto"), told);
        assertTrue("the vanished follower is dropped from every parent", book.of("root").isEmpty());
        assertEquals(Collections.singletonList("auto"), book.of("kept"));
    }

    @Test public void aFollowerThatFailsWhenToldIsForgotten() {
        SubscriptionBook<String> book = new SubscriptionBook<>();
        book.add("kept", "auto");
        book.add("kept", "dead");
        java.util.List<String> told = new java.util.ArrayList<>();
        book.deliver("kept", Arrays.asList("auto", "dead"), who -> {
            if (who.equals("dead")) throw new IllegalStateException("binder died");
            told.add(who);
        });
        assertEquals(Collections.singletonList("auto"), told);
        assertEquals(Collections.singletonList("auto"), book.of("kept"));
    }
}
