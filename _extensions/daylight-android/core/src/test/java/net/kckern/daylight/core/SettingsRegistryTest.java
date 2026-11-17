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
}
