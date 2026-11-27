package net.kckern.daylight.cap.mediaservice.shell;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

public class QueueTagTest {
    private static final QueueTag ALBUM = new QueueTag("Blue", "c:plex:50", false);

    @Test public void theAskedIdIsTheStartItemsTag() {
        assertEquals("c:plex:50", QueueTag.askedOfTags(Arrays.asList(null, ALBUM, null), 1));
        assertEquals("no tag", "", QueueTag.askedOfTags(Arrays.asList(null, ALBUM), 0));
        assertEquals("not a queue tag", "", QueueTag.askedOfTags(Collections.singletonList("x"), 0));
        assertEquals("a start past the end is the last item", "c:plex:50", QueueTag.askedOfTags(Arrays.asList(null, ALBUM), 9));
        assertEquals("before the start is the first", "", QueueTag.askedOfTags(Arrays.asList(null, ALBUM), -3));
        assertEquals("", QueueTag.askedOfTags(Collections.emptyList(), 0));
        assertEquals("", QueueTag.askedOfTags(null, 0));
    }
}
