package net.kckern.daylight.api;

import static org.junit.Assert.*;

import org.junit.After;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

public class ShellComponentsTest {
    @After public void tearDown() { ShellComponents.setListener(null); ShellComponents.publish("x", null); }

    @Test public void aPublishedComponentCanBeReadBackAndRemoved() {
        Object engine = new Object();
        ShellComponents.publish("x", engine);
        assertSame(engine, ShellComponents.get("x"));
        ShellComponents.publish("x", null);
        assertNull(ShellComponents.get("x"));
    }

    @Test public void theListenerHearsBindAndUnbind() {
        List<String> heard = new ArrayList<>();
        ShellComponents.setListener((name, instance) -> heard.add(name + "=" + (instance != null)));
        ShellComponents.publish("x", new Object());
        ShellComponents.publish("x", null);
        assertEquals(java.util.Arrays.asList("x=true", "x=false"), heard);
    }

    @Test public void publishingWithNoListenerIsNotAnError() {
        ShellComponents.publish("x", new Object());
        assertNotNull(ShellComponents.get("x"));
    }
}
