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

    // ── rules: allowed values and ranges ────────────────────────────────────

    private SettingsRegistry ruled() {
        SettingsRegistry s = new SettingsRegistry(file);
        s.declare("bluetooth.mode", Type.STRING, "roles", SettingsRegistry.oneOf("roles", "gamepad"));
        s.declare("keys.doublePressMs", Type.INTEGER, 450, SettingsRegistry.range(150, 2000));
        return s;
    }

    @Test public void aValueOutsideTheAllowedSetIsRefusedAtSetAndNothingIsStored() {
        SettingsRegistry s = ruled();
        try {
            s.set("bluetooth.mode", "gamepads");
            fail("a value outside the allowed set was stored");
        } catch (InvalidSettingException expected) {
            assertTrue(expected.getMessage(), expected.getMessage().contains("bluetooth.mode"));
        }
        assertEquals("roles", s.get("bluetooth.mode"));
        assertFalse(file.exists());
        s.set("bluetooth.mode", "gamepad");
        assertEquals("gamepad", s.get("bluetooth.mode"));
    }

    @Test public void aNumberOutsideTheRangeIsRefusedAtSet() {
        SettingsRegistry s = ruled();
        for (Object bad : new Object[] { 149, 2001, "100000", -1 }) {
            try { s.set("keys.doublePressMs", bad); fail("accepted " + bad); } catch (InvalidSettingException expected) { }
        }
        s.set("keys.doublePressMs", 150);
        s.set("keys.doublePressMs", "2000");
        assertEquals(2000, s.get("keys.doublePressMs"));
    }

    @Test(expected = InvalidSettingException.class)
    public void aDeviceDefaultOutsideTheAllowedSetIsRefused() throws Exception {
        ruled().applyDefaults(new JSONObject("{\"bluetooth.mode\":\"gamepads\"}"));
    }

    @Test(expected = InvalidSettingException.class)
    public void aDeviceDefaultOutsideTheRangeIsRefused() throws Exception {
        ruled().applyDefaults(new JSONObject("{\"keys.doublePressMs\":5}"));
    }

    @Test(expected = InvalidSettingException.class)
    public void aFallbackMustSatisfyItsOwnRule() {
        new SettingsRegistry(file).declare("bluetooth.mode", Type.STRING, "neither", SettingsRegistry.oneOf("roles", "gamepad"));
    }

    @Test public void aStoredOverrideThatBreaksTheRuleIsIgnoredNotThrownAndLoggedOnce() throws Exception {
        // What an older payload, with no rule on the setting, left on disk.
        java.nio.file.Files.write(file.toPath(),
                "{\"bluetooth.mode\":\"gamepads\",\"keys.doublePressMs\":9}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        SettingsRegistry s = ruled();
        assertEquals("roles", s.get("bluetooth.mode"));
        assertEquals("roles", s.get("bluetooth.mode"));
        assertEquals(450, s.get("keys.doublePressMs"));
        for (int i = 0; i < s.describe().length(); i++) {
            JSONObject row = s.describe().getJSONObject(i);
            assertFalse(row.getString("key"), row.getBoolean("overridden"));
        }
        int reports = 0;
        org.json.JSONArray log = Diag.recent();
        for (int i = 0; i < log.length(); i++) {
            if (log.getString(i).contains("'bluetooth.mode' is no longer valid")) reports++;
            assertFalse("the stored value is not logged", log.getString(i).contains("gamepads"));
        }
        assertEquals(1, reports);
    }

    @Test public void describeListsWhatARuleAllows() throws Exception {
        org.json.JSONArray rows = ruled().describe();
        assertEquals("[\"roles\",\"gamepad\"]", rows.getJSONObject(0).getJSONArray("allowed").toString());
        assertEquals(150, rows.getJSONObject(1).getInt("min"));
        assertEquals(2000, rows.getJSONObject(1).getInt("max"));
    }

    // ── several settings as one change ──────────────────────────────────────

    private static java.util.Map<String, Object> of(Object... pairs) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) m.put((String) pairs[i], pairs[i + 1]);
        return m;
    }

    @Test public void setAllStoresEveryValueAndTellsListenersOfEach() {
        SettingsRegistry s = fresh();
        java.util.List<String> heard = new java.util.ArrayList<>();
        s.onChange(heard::add);
        s.setAll(of("webview.startUrl", "https://kiosk.example/", "recovery.retrySec", "30", "power.keepScreenOn", true));
        assertEquals("https://kiosk.example/", s.get("webview.startUrl"));
        assertEquals(30, s.get("recovery.retrySec"));
        assertEquals(Boolean.TRUE, s.get("power.keepScreenOn"));
        assertEquals(java.util.Arrays.asList("webview.startUrl", "recovery.retrySec", "power.keepScreenOn"), heard);
        assertEquals(30, fresh().get("recovery.retrySec"));
    }

    @Test public void setAllWithOneRefusedValueChangesNothing() {
        SettingsRegistry s = fresh();
        s.set("webview.startUrl", "https://kiosk.example/old");
        java.util.List<String> heard = new java.util.ArrayList<>();
        s.onChange(heard::add);
        try {
            s.setAll(of("webview.startUrl", "https://kiosk.example/new", "recovery.retrySec", "soon"));
            fail("a refused value was accepted");
        } catch (InvalidSettingException expected) { }
        try {
            s.setAll(of("webview.startUrl", "https://kiosk.example/new", "no.such.key", 1));
            fail("an unknown key was accepted");
        } catch (UnknownSettingException expected) { }
        assertEquals("the first value of the batch was not applied", "https://kiosk.example/old", s.get("webview.startUrl"));
        assertEquals(0, s.get("recovery.retrySec"));
        assertTrue(heard.isEmpty());
        assertEquals("https://kiosk.example/old", fresh().get("webview.startUrl"));
    }

    @Test public void setAllThatCannotBeWrittenLeavesMemoryAsItWas() throws Exception {
        SettingsRegistry s = fresh();
        s.set("recovery.retrySec", 5);
        // A directory where the temporary file should go: the write fails.
        assertTrue(new File(file.getPath() + ".part").mkdir());
        try {
            s.setAll(of("recovery.retrySec", 60, "power.keepScreenOn", true));
            fail("the write cannot have succeeded");
        } catch (IllegalStateException expected) { }
        assertEquals(5, s.get("recovery.retrySec"));
        assertEquals(Boolean.FALSE, s.get("power.keepScreenOn"));
    }

    // ── a stored state that cannot be read ────────────────────────────────────

    private static void write(File f, String text) throws Exception {
        java.nio.file.Files.write(f.toPath(), text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test public void aCorruptOverridesFileFallsBackToTheLastGoodOneAndSaysSo() throws Exception {
        SettingsRegistry s = fresh();
        s.set("recovery.retrySec", 5);            // first write: no backup yet
        s.set("power.keepScreenOn", true);        // second write: the first state becomes the backup
        assertTrue(SettingsRegistry.backupOf(file).isFile());
        write(file, "{\"recovery.retrySec\":5,\"power.keepScr");   // torn by a power cut

        SettingsRegistry again = fresh();
        assertEquals("the last good state is in effect", 5, again.get("recovery.retrySec"));
        assertNotNull("and it is not passed over without a word", again.loadProblem());
        assertTrue(again.loadProblem(), again.loadProblem().contains("using the backup"));
        assertFalse("no value is ever part of the message", again.loadProblem().contains("5"));
    }

    @Test public void aCorruptFileWithNoBackupMeansDefaultsAndSaysSo() throws Exception {
        write(file, "not json");
        SettingsRegistry s = fresh();
        assertEquals(0, s.get("recovery.retrySec"));
        assertTrue(s.loadProblem(), s.loadProblem().contains("compiled defaults apply"));
        s.set("recovery.retrySec", 7);            // still writable afterwards
        assertEquals(7, fresh().get("recovery.retrySec"));
        assertFalse("a corrupt file is not kept as the last good one", SettingsRegistry.backupOf(file).isFile());
    }

    @Test public void aMissingFileWithABackupUsesTheBackup() throws Exception {
        // A write interrupted between its two renames leaves exactly this.
        write(SettingsRegistry.backupOf(file), "{\"recovery.retrySec\":9}");
        SettingsRegistry s = fresh();
        assertEquals(9, s.get("recovery.retrySec"));
        assertNotNull(s.loadProblem());
    }

    @Test public void aHealthyStoreAndAnEmptyOneReportNoProblem() throws Exception {
        assertNull(fresh().loadProblem());
        SettingsRegistry s = fresh();
        s.set("recovery.retrySec", 5);
        assertNull(fresh().loadProblem());
        assertFalse("no temporary file is left behind", new File(file.getPath() + ".part").exists());
    }

    // ── settings only the device file decides, and guarded changes ───────────

    @Test public void aCompiledSettingCannotBeChangedOnTheDeviceAndIgnoresAStoredOverride() throws Exception {
        write(file, "{\"lockdown.required\":false}");              // somebody edited the file by hand
        SettingsRegistry s = new SettingsRegistry(file);
        s.declareCompiled("lockdown.required", Type.BOOLEAN, false);
        s.applyDefaults(new JSONObject("{\"lockdown.required\":true}"));
        assertEquals("the stored override is not honored", Boolean.TRUE, s.get("lockdown.required"));
        for (Runnable change : new Runnable[] { () -> s.set("lockdown.required", false), () -> s.reset("lockdown.required"),
                () -> s.setAll(of("lockdown.required", false)) }) {
            try {
                change.run();
                fail("a compiled setting was changed on the device");
            } catch (InvalidSettingException expected) {
                assertTrue(expected.getMessage(), expected.getMessage().contains("device file"));
            }
        }
        assertEquals(Boolean.TRUE, s.get("lockdown.required"));
        assertFalse(s.describe().toString().contains("\"overridden\":true"));
    }

    @Test public void aGuardRefusesAValueWithItsReasonForSetSetAllAndReset() throws Exception {
        SettingsRegistry s = fresh();
        s.applyDefaults(new JSONObject("{\"power.keepScreenOn\":false}"));
        s.guard("power.keepScreenOn", v -> Boolean.FALSE.equals(v) ? "cannot be false here" : null);
        s.set("power.keepScreenOn", true);
        try { s.set("power.keepScreenOn", false); fail(); } catch (InvalidSettingException e) { assertTrue(e.getMessage().contains("cannot be false here")); }
        try { s.setAll(of("recovery.retrySec", 9, "power.keepScreenOn", false)); fail(); } catch (InvalidSettingException expected) { }
        assertEquals("nothing of the refused batch was applied", 0, s.get("recovery.retrySec"));
        // A reset would put the default (false) in effect: the same change by another road.
        try { s.reset("power.keepScreenOn"); fail(); } catch (InvalidSettingException expected) { }
        assertEquals(Boolean.TRUE, s.get("power.keepScreenOn"));
    }
}
