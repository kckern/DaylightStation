package net.kckern.daylight.cap.applauncher;

import static org.junit.Assert.*;

import org.json.JSONObject;
import org.junit.Test;

public class LaunchRequestTest {
    private static LaunchRequest parse(String json) throws Exception { return LaunchRequest.parse(new JSONObject(json)); }

    @Test public void aPackageAlone() throws Exception {
        LaunchRequest r = parse("{\"package\":\"org.example.stream\"}");
        assertEquals("org.example.stream", r.pkg);
        assertNull(r.activity);
        assertNull(r.intentUri);
        assertTrue(r.extras.isEmpty());
    }

    @Test public void aShortActivityNameIsExpanded() throws Exception {
        assertEquals("com.a.b.Main", parse("{\"package\":\"com.a.b\",\"activity\":\".Main\"}").activity);
        assertEquals("com.x.Other", parse("{\"package\":\"com.a.b\",\"activity\":\"com.x.Other\"}").activity);
    }

    @Test public void actionAndStringExtras() throws Exception {
        LaunchRequest r = parse("{\"package\":\"com.retroarch.aarch64\",\"activity\":\"com.retroarch.browser.retroactivity.RetroActivityFuture\","
                + "\"action\":\"android.intent.action.MAIN\",\"extras\":{\"ROM\":\"/roms/a b#1.gb\",\"LIBRETRO\":\"x.so\"}}");
        assertEquals("android.intent.action.MAIN", r.action);
        assertEquals("/roms/a b#1.gb", r.extras.get("ROM"));
        assertEquals(2, r.extras.size());
    }

    @Test public void anIntentUri() throws Exception {
        LaunchRequest r = parse("{\"intent\":\"intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end\"}");
        assertEquals("intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end", r.intentUri);
        assertNull(r.pkg);
    }

    @Test public void rejectsWhatItCannotStartSafely() {
        for (String bad : new String[] {
                "{}", "{\"package\":\"notapackage\"}", "{\"package\":\"com.a.b; rm -rf\"}", "{\"package\":7}",
                "{\"package\":\"com.a.b\",\"activity\":\"bad name\"}",
                "{\"package\":\"com.a.b\",\"action\":\"x;y\"}",
                "{\"package\":\"com.a.b\",\"extras\":{\"a;b\":\"v\"}}",
                "{\"package\":\"com.a.b\",\"extras\":{\"k\":5}}",
                "{\"package\":\"com.a.b\",\"extras\":\"nope\"}",
                "{\"intent\":\"https://example.test/\"}", "{\"intent\":\"intent:\"}",
                "{\"intent\":\"intent:#Intent;end\",\"package\":\"com.a.b\"}" }) {
            try { parse(bad); fail("expected rejection of " + bad); }
            catch (IllegalArgumentException expected) { }
            catch (Exception other) { fail("wrong exception for " + bad + ": " + other); }
        }
    }

    // ── intent: URIs from the page ────────────────────────────────────────────

    @Test public void anIntentUriMustBeAWholeIntentUri() {
        for (String bad : new String[] {
                "intent:#Intent;action=android.intent.action.VIEW",             // no ;end
                "intent:action=android.intent.action.VIEW;end",                // no #Intent;
                "intent://example.test/#Other;end" }) {
            try { LaunchRequest.parse(new JSONObject().put("intent", bad)); fail("expected rejection of " + bad); }
            catch (IllegalArgumentException expected) { }
            catch (Exception other) { fail("wrong exception for " + bad + ": " + other); }
        }
    }

    @Test public void anIntentUriCannotCarryAFileOrContentUri() {
        for (String bad : new String[] {
                "intent:///sdcard/Download/a.apk#Intent;scheme=file;type=application/vnd.android.package-archive;end",
                "intent://media/external/images/1#Intent;scheme=content;end",
                "intent://x/y#Intent;scheme=FILE;end",
                "intent:file:///sdcard/a.apk#Intent;action=android.intent.action.VIEW;end",
                "intent:content://com.example.provider/secret#Intent;end" }) {
            try { LaunchRequest.parse(new JSONObject().put("intent", bad)); fail("expected rejection of " + bad); }
            catch (IllegalArgumentException expected) { }
            catch (Exception other) { fail("wrong exception for " + bad + ": " + other); }
        }
    }

    @Test public void anIntentUriCannotCarryASelector() {
        // A selector resolves the launch through a second intent, past the component that is checked.
        String uri = "intent:#Intent;action=android.intent.action.MAIN;SEL;component=com.example.other/.Main;end";
        try { LaunchRequest.parse(new JSONObject().put("intent", uri)); fail("expected rejection"); }
        catch (IllegalArgumentException expected) { }
        catch (Exception other) { fail("wrong exception: " + other); }
    }

    @Test public void anOrdinaryIntentUriIsAccepted() throws Exception {
        String uri = "intent://example.test/watch#Intent;scheme=https;package=com.example.player;S.title=a%3Bb;end";
        assertEquals(uri, LaunchRequest.parse(new JSONObject().put("intent", uri)).intentUri);
    }
}
