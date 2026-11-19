package net.kckern.daylight.core;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class EventBusTest {
    @Test public void deliversToEverySubscriberAndSurvivesOneThatThrows() throws Exception {
        EventBus bus = new EventBus();
        List<String> seen = new ArrayList<>();
        bus.subscribe((topic, detail) -> { throw new IllegalStateException("bug"); });
        bus.subscribe((topic, detail) -> seen.add(topic + ":" + detail.optBoolean("on")));
        bus.publish("screen", new JSONObject().put("on", true));
        assertEquals(java.util.Arrays.asList("screen:true"), seen);
    }

    @Test public void anUnsubscribedListenerHearsNothing() {
        EventBus bus = new EventBus();
        List<String> seen = new ArrayList<>();
        EventBus.Listener l = (topic, detail) -> seen.add(topic);
        bus.subscribe(l);
        bus.unsubscribe(l);
        bus.publish("screen", new JSONObject());
        assertTrue(seen.isEmpty());
    }
}
