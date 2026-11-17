package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.SettingsRegistry.InvalidSettingException;
import net.kckern.daylight.core.SettingsRegistry.Type;
import net.kckern.daylight.core.SettingsRegistry.UnknownSettingException;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;

public class SettingsRegistryTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();
    private File file;

    @Before public void setUp() throws Exception { file = new File(tmp.newFolder(), "overrides.json"); }

    private SettingsRegistry fresh() {
        SettingsRegistry s = new SettingsRegistry(file);
        s.declare("power.keepScreenOn", Type.BOOLEAN, false);
        s.declare("recovery.retrySec", Type.INTEGER, 0);
        s.declare("webview.startUrl", Type.STRING, "");
        return s;
    }

    @Test public void aDeclaredSettingReadsItsFallback() {
        assertEquals(Boolean.FALSE, fresh().get("power.keepScreenOn"));
    }

    @Test public void deviceDefaultsReplaceTheFallback() throws Exception {
        SettingsRegistry s = fresh();
        s.applyDefaults(new JSONObject("{\"recovery.retrySec\":30}"));
        assertEquals(30, s.get("recovery.retrySec"));
    }

    @Test(expected = UnknownSettingException.class)
    public void aDefaultForAnUndeclaredKeyIsRejected() throws Exception {
        fresh().applyDefaults(new JSONObject("{\"setCpuWakelock\":true}"));
    }

    @Test(expected = UnknownSettingException.class)
    public void settingAnUnknownKeyIsRejected() { fresh().set("setCpuWakelock", "true"); }

    @Test(expected = UnknownSettingException.class)
    public void readingAnUnknownKeyIsRejected() { fresh().get("nope"); }

    @Test(expected = InvalidSettingException.class)
    public void aWrongTypeIsRejected() { fresh().set("recovery.retrySec", "soon"); }

    @Test(expected = InvalidSettingException.class)
    public void aBooleanMustBeTrueOrFalse() { fresh().set("power.keepScreenOn", "yes"); }

    @Test public void stringsFromHttpAreCoerced() {
        SettingsRegistry s = fresh();
        s.set("recovery.retrySec", "45");
        s.set("power.keepScreenOn", "true");
        assertEquals(45, s.get("recovery.retrySec"));
        assertEquals(Boolean.TRUE, s.get("power.keepScreenOn"));
    }

    @Test public void anOverrideSurvivesANewRegistryWithNewDefaults() throws Exception {
        fresh().set("webview.startUrl", "http://override");
        SettingsRegistry next = fresh();                       // a payload swap
        next.applyDefaults(new JSONObject("{\"webview.startUrl\":\"http://new-default\"}"));
        assertEquals("http://override", next.get("webview.startUrl"));
    }

    @Test public void resetReturnsToTheDefaultAndForgetsTheOverride() throws Exception {
        SettingsRegistry s = fresh();
        s.applyDefaults(new JSONObject("{\"recovery.retrySec\":30}"));
        s.set("recovery.retrySec", 5);
        s.reset("recovery.retrySec");
        assertEquals(30, s.get("recovery.retrySec"));
        assertEquals(0, fresh().get("recovery.retrySec"));     // nothing left on disk
    }

    @Test public void describeReportsValueDefaultAndOverridden() throws Exception {
        SettingsRegistry s = fresh();
        s.set("recovery.retrySec", 5);
        JSONObject row = null;
        for (int i = 0; i < s.describe().length(); i++) {
            JSONObject o = s.describe().getJSONObject(i);
            if (o.getString("key").equals("recovery.retrySec")) row = o;
        }
        assertNotNull(row);
        assertEquals("INTEGER", row.getString("type"));
        assertEquals(5, row.getInt("value"));
        assertEquals(0, row.getInt("default"));
        assertTrue(row.getBoolean("overridden"));
    }

    @Test(expected = IllegalStateException.class)
    public void declaringAKeyTwiceIsAProgrammingError() {
        fresh().declare("webview.startUrl", Type.STRING, "");
    }

    @Test public void anOverrideForAKeyThisPayloadDoesNotDeclareIsKeptOnDisk() {
        fresh().set("webview.startUrl", "http://override");
        SettingsRegistry smaller = new SettingsRegistry(file);  // older payload, fewer settings
        smaller.declare("recovery.retrySec", Type.INTEGER, 0);
        smaller.set("recovery.retrySec", 9);
        assertEquals("http://override", fresh().get("webview.startUrl"));
    }

    @Test public void aSetThatCannotBePersistedLeavesTheOldValue() throws Exception {
        File notADir = tmp.newFile("blocker");
        SettingsRegistry s = new SettingsRegistry(new File(new File(notADir, "sub"), "overrides.json"));
        s.declare("recovery.retrySec", Type.INTEGER, 0);
        try {
            s.set("recovery.retrySec", 5);
            fail("expected set to throw when the overrides file cannot be written");
        } catch (IllegalStateException expected) { }
        assertEquals(0, s.get("recovery.retrySec"));
    }

    @Test public void aResetThatCannotBePersistedKeepsTheOverride() throws Exception {
        SettingsRegistry s = fresh();
        s.set("recovery.retrySec", 5);
        // Replace the overrides directory with a regular file so the next write fails.
        File dir = file.getParentFile();
        assertTrue(file.delete());
        assertTrue(dir.delete());
        assertTrue(dir.createNewFile());
        try {
            s.reset("recovery.retrySec");
            fail("expected reset to throw when the overrides file cannot be written");
        } catch (IllegalStateException expected) { }
        assertEquals(5, s.get("recovery.retrySec"));
    }

    @Test public void anOverrideThatNoLongerFitsItsTypeIsNotReportedAsOverridden() throws Exception {
        java.nio.file.Files.write(file.toPath(),
                "{\"recovery.retrySec\":\"soon\"}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        JSONObject row = null;
        org.json.JSONArray rows = fresh().describe();
        for (int i = 0; i < rows.length(); i++) {
            JSONObject o = rows.getJSONObject(i);
            if (o.getString("key").equals("recovery.retrySec")) row = o;
        }
        assertNotNull(row);
        assertEquals(0, row.getInt("value"));
        assertFalse(row.getBoolean("overridden"));
    }

    @Test public void aSecretIsNeverDescribedInTheClear() throws Exception {
        SettingsRegistry s = fresh();
        s.declareSecret("presence.token");
        s.set("presence.token", "s3cret-value");
        assertEquals("s3cret-value", s.get("presence.token"));
        JSONObject row = null;
        for (int i = 0; i < s.describe().length(); i++) {
            JSONObject o = s.describe().getJSONObject(i);
            if (o.getString("key").equals("presence.token")) row = o;
        }
        assertNotNull(row);
        assertTrue(row.getBoolean("secret"));
        assertEquals("(set)", row.getString("value"));
        assertFalse(s.describe().toString().contains("s3cret-value"));
    }

    @Test public void anUnsetSecretDescribesAsEmpty() throws Exception {
        SettingsRegistry s = fresh();
        s.declareSecret("presence.token");
        assertEquals("", s.describe().getJSONObject(3).getString("value"));
    }

    @Test public void listenersHearSetAndResetButNotAFailedSet() {
        SettingsRegistry s = fresh();
        java.util.List<String> heard = new java.util.ArrayList<>();
        s.onChange(heard::add);
        s.set("recovery.retrySec", 5);
        s.reset("recovery.retrySec");
        try { s.set("recovery.retrySec", "soon"); } catch (InvalidSettingException expected) { }
        assertEquals(java.util.Arrays.asList("recovery.retrySec", "recovery.retrySec"), heard);
    }

    @Test public void aListenerThatThrowsDoesNotBreakTheWrite() {
        SettingsRegistry s = fresh();
        s.onChange(key -> { throw new IllegalStateException("boom"); });
        s.set("recovery.retrySec", 5);
        assertEquals(5, s.get("recovery.retrySec"));
    }

    @Test(expected = InvalidSettingException.class)
    public void aSecretCannotHaveACompiledDefault() throws Exception {
        SettingsRegistry s = fresh();
        s.declareSecret("presence.token");
        s.applyDefaults(new JSONObject("{\"presence.token\":\"in-a-public-repo\"}"));
    }
}
