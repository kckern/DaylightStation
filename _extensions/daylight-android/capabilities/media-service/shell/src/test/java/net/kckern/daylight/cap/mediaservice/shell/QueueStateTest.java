package net.kckern.daylight.cap.mediaservice.shell;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

/** The saved queue (spec §7): regions, label, order, shuffle, repeat and place survive a restart. */
public class QueueStateTest {
    private static final QueueState.Codec<String> CODEC = new QueueState.Codec<String>() {
        @Override public JSONObject write(String item) throws Exception { return new JSONObject().put("id", item); }
        @Override public String read(JSONObject o) { return o == null || o.optString("id").isEmpty() ? null : o.optString("id"); }
    };

    private static QueueModel<String> model(QueueModelTest.Player p) {
        QueueModel<String> q = new QueueModel<>(s -> s, s -> s.startsWith("book"), new Random(3));
        q.attach(p);
        return q;
    }

    @Test public void everythingComesBackPausedAtItsPlace() throws Exception {
        QueueModelTest.Player p = new QueueModelTest.Player();
        QueueModel<String> q = model(p);
        List<String> album = Arrays.asList("a1", "a2", "a3", "a4");
        q.replace(new ArrayList<>(album), 0, -1, 0, "Snakes & Arrows", "c:album", null, false);
        q.add(Arrays.asList("X"), true, "");
        q.add(Arrays.asList("s1", "s2"), false, "Signals");
        p.current = 1;
        q.onTransition(1);                      // X plays
        q.setShuffle(true);
        q.setRepeat(QueueModel.Repeat.ALL);
        JSONObject saved = new JSONObject(QueueState.encode(q, 93_000, CODEC).toString());

        QueueModelTest.Player p2 = new QueueModelTest.Player();
        QueueModel<String> back = model(p2);
        int n = QueueState.apply(back, saved, CODEC);
        assertEquals(q.size(), n);
        assertEquals(q.items(), p2.items);
        assertEquals(1, p2.current);
        assertEquals(93_000, p2.position);
        assertEquals("Snakes & Arrows", back.label());
        assertTrue(back.shuffled());
        assertEquals(QueueModel.Repeat.ALL, back.repeat());
        assertEquals(2, back.count(QueueModel.Region.QUEUED));
        assertEquals("Signals", back.at(2).groupLabel);
        assertEquals(album, back.sourceAll());
        // Shuffle off restores the source's order after a restart too.
        back.setShuffle(false);
        assertEquals(Arrays.asList("a2", "a3", "a4"), back.items().subList(4, 7));
    }

    @Test public void aDamagedSaveIsIgnored() throws Exception {
        QueueModel<String> back = model(new QueueModelTest.Player());
        assertEquals(0, QueueState.apply(back, new JSONObject().put("v", 99), CODEC));
        assertEquals(0, QueueState.apply(back, null, CODEC));
        assertEquals(0, back.size());
    }
}
