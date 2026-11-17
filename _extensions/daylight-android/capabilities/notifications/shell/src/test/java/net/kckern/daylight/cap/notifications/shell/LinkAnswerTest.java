package net.kckern.daylight.cap.notifications.shell;

import static org.junit.Assert.*;

import org.junit.Test;

public class LinkAnswerTest {
    @Test public void readsTheThreeEffects() {
        assertEquals(LinkAnswer.Kind.NONE, LinkAnswer.of("{\"ok\":true,\"effect\":\"none\"}").kind);
        assertEquals(LinkAnswer.Kind.FRONT, LinkAnswer.of("{\"ok\":true,\"effect\":\"front\"}").kind);
        LinkAnswer toast = LinkAnswer.of("{\"ok\":true,\"effect\":\"toast\",\"message\":\"Lights off: done\"}");
        assertEquals(LinkAnswer.Kind.TOAST, toast.kind);
        assertEquals("Lights off: done", toast.message);
    }

    @Test public void aRefusalIsShownAsItsMessage() {
        LinkAnswer refused = LinkAnswer.of("{\"ok\":false,\"error\":\"forbidden\",\"message\":\"That link is not allowed\"}");
        assertEquals(LinkAnswer.Kind.TOAST, refused.kind);
        assertEquals("That link is not allowed", refused.message);
        assertEquals("That did not work", LinkAnswer.of("{\"ok\":false}").message);
    }

    @Test public void anEffectThisShellDoesNotKnowDoesNothing() {
        // A newer payload may name an effect an older installed shell has never heard of.
        // It must not be guessed at, and nothing in the answer is ever started or opened.
        LinkAnswer a = LinkAnswer.of("{\"ok\":true,\"effect\":\"activity\",\"intentUri\":\"intent:#Intent;component=x/.Y;end\"}");
        assertEquals(LinkAnswer.Kind.NONE, a.kind);
        assertEquals(LinkAnswer.Kind.NONE, LinkAnswer.of("{\"ok\":true}").kind);
    }

    @Test public void anAnswerThatIsNotJsonOrNoAnswerIsTheStartingMessage() {
        for (String none : new String[] { null, "", "garbage", "[]" }) {
            LinkAnswer a = LinkAnswer.of(none);
            assertEquals(String.valueOf(none), LinkAnswer.Kind.TOAST, a.kind);
            assertEquals(LinkAnswer.NOT_READY, a.message);
        }
        assertEquals(LinkAnswer.NOT_READY, LinkAnswer.notReady().message);
    }

    @Test public void aLongMessageIsCut() {
        LinkAnswer a = LinkAnswer.of("{\"ok\":true,\"effect\":\"toast\",\"message\":\"" + "x".repeat(1000) + "\"}");
        assertEquals(200, a.message.length());
    }
}
