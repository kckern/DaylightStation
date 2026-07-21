package net.kckern.pianobridge;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import net.kckern.pianobridge.KioskSettingsGuard.Params;
import net.kckern.pianobridge.KioskSettingsGuard.Verdict;

/**
 * The guard's per-tick decision, exercised with no device and no network.
 *
 * The single most important behaviour asserted here is what the guard does NOT do.
 * It re-arms kiosk mode, and FKB's kiosk mode auto-dismisses Android's install dialog
 * with INSTALL_FAILED_ABORTED — so a guard that re-asserts at the wrong moment breaks
 * the very deploy that ships it (README.md:163-168 disables kiosk mode for exactly
 * this reason). Hence installHold_writesNothing and disarmed_readsNothing.
 */
public class KioskSettingsGuardTest {

    // --- fakes ------------------------------------------------------------

    /** Records every read and write so tests can assert on "did nothing". */
    private static class FakeFkb implements KioskSettingsGuard.Fkb {
        Map<String, String> live = new HashMap<>();
        int reads = 0;
        final List<String> writes = new ArrayList<>();

        @Override public Map<String, String> listSettings() { reads++; return live; }
        @Override public boolean setBoolean(String key, String value) {
            writes.add("bool:" + key + "=" + value); live.put(key, value); return true;
        }
        @Override public boolean setString(String key, String value) {
            writes.add("str:" + key + "=" + value); live.put(key, value); return true;
        }
    }

    private static final class FakeNotes implements KioskSettingsGuard.Notes {
        final List<String> lines = new ArrayList<>();
        @Override public void note(String kind, String msg) { lines.add(kind + " " + msg); }
        int countContaining(String needle) {
            int n = 0;
            for (String l : lines) if (l.contains(needle)) n++;
            return n;
        }
    }

    /** A live settings map that matches the desired set exactly. */
    private static Map<String, String> healthy() {
        Map<String, String> m = new HashMap<>();
        for (Map.Entry<String, KioskSettings.Desired> e : KioskSettings.DESIRED.entrySet()) {
            m.put(e.getKey(), e.getValue().value);
        }
        return m;
    }

    /** The configured hold DURATION. Only used to compute new deadlines / for display. */
    private static final long HOLD_MS = 900_000L;

    /**
     * @param installHoldUntilMs the PERSISTED hold deadline (epoch ms), as it would be
     *                           read back from config after a service restart. 0 = none.
     */
    private static Params params(boolean enabled, boolean hasPassword,
                                 long disarmUntilMs, long installHoldUntilMs) {
        return new Params(enabled, 60_000L, HOLD_MS, installHoldUntilMs, disarmUntilMs, hasPassword);
    }

    /** Guard wired to fakes, with a fixed clock and a settable last-/update stamp. */
    private static KioskSettingsGuard guard(FakeFkb fkb, FakeNotes notes,
                                            Params p, long nowMs, long lastUpdateAtMs) {
        return new KioskSettingsGuard(() -> p, () -> lastUpdateAtMs, fkb, notes, () -> nowMs);
    }

    // --- the happy path ---------------------------------------------------

    @Test
    public void driftFound_writesOnlyTheDriftedKeys_withTheRightSetterPerType() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");        // BOOL  → setBooleanSetting
        fkb.live.put("reloadPageFailure", "0");    // STRING → setStringSetting
        FakeNotes notes = new FakeNotes();

        Verdict v = guard(fkb, notes, params(true, true, 0, 900_000L), 1_000_000L, 0L).tick();

        assertEquals(Verdict.REPAIRED, v);
        assertEquals("only the two drifted keys — never the whole desired set",
                2, fkb.writes.size());
        assertTrue(fkb.writes.contains("bool:kioskMode=true"));
        assertTrue(fkb.writes.contains("str:reloadPageFailure=30"));

        // The log line is the whole point: it is how the drift becomes visible.
        assertEquals(1, notes.countContaining("KIOSKSET"));
        String line = notes.lines.get(0);
        assertTrue(line, line.contains("kioskMode") && line.contains("false") && line.contains("true"));
    }

    @Test
    public void noDrift_writesNothing() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();

        Verdict v = guard(fkb, new FakeNotes(), params(true, true, 0, 900_000L), 1_000_000L, 0L).tick();

        assertEquals(Verdict.OK, v);
        assertEquals(1, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    // --- the do-no-harm paths ---------------------------------------------

    @Test
    public void installHold_writesNothing() {
        // An /update stamped a deadline 14 min out. Re-arming kiosk mode now would
        // auto-dismiss Android's install confirm dialog (INSTALL_FAILED_ABORTED) and
        // break the deploy in progress.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");   // deploy step 4 turned it off, correctly
        long now = 1_000_000L;

        Verdict v = guard(fkb, new FakeNotes(), params(true, true, 0, now + 840_000L),
                now, now - 60_000L).tick();

        assertEquals(Verdict.INSTALL_HOLD, v);
        assertEquals("must not even read while an install may be in flight", 0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    @Test
    public void installHoldExpires_andTheGuardResumes() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        // Deadline already passed.
        Verdict v = guard(fkb, new FakeNotes(), params(true, true, 0, now - 1L),
                now, now - 960_000L).tick();

        assertEquals(Verdict.REPAIRED, v);
        assertEquals(1, fkb.writes.size());
        assertTrue(fkb.writes.contains("bool:kioskMode=true"));
    }

    @Test
    public void installHold_survivesTheServiceRestartTheInstallItselfCauses() {
        // THE DEFECT THIS FIXES (found deploying v22, 2026-07-21). An APK install stops
        // the service; deploy step 7 relaunches it — and step 7 says "repeat until
        // pbctl status answers", so this can happen more than once. When the hold lived
        // only in a PianoBridgeService field it reset to 0 on every one of those
        // restarts, and the 15-minute suppression silently evaporated. A retried or
        // second install then landed with NO hold at all.
        //
        // A fresh guard (in-memory state empty, exactly as after a restart) must still
        // refuse, on the strength of the PERSISTED deadline alone.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        KioskSettingsGuard freshAfterRestart = guard(fkb, new FakeNotes(),
                params(true, true, 0, now + 600_000L),  // persisted: 10 min left
                now,
                0L);                                     // in-memory: nothing, we just booted

        assertEquals(Verdict.INSTALL_HOLD, freshAfterRestart.tick());
        assertEquals(0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    @Test
    public void installHold_takesTheLaterOfInMemoryAndPersisted_persistedWins() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        // Persisted deadline is in the future, in-memory has none.
        KioskSettingsGuard g = guard(fkb, new FakeNotes(),
                params(true, true, 0, now + 300_000L), now, 0L);
        assertEquals(Verdict.INSTALL_HOLD, g.tick());
    }

    @Test
    public void installHold_takesTheLaterOfInMemoryAndPersisted_inMemoryWins() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        // Persisted deadline has EXPIRED, but a newer /update set a live one. The stale
        // persisted value must not shorten the running hold.
        KioskSettingsGuard g = guard(fkb, new FakeNotes(),
                params(true, true, 0, now - 500_000L), now, 0L);
        g.setInstallHoldUntil(now + 300_000L);

        assertEquals(Verdict.INSTALL_HOLD, g.tick());
        assertEquals(0, fkb.reads);
    }

    @Test
    public void installHold_bothExpired_lettingTheGuardRun() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        KioskSettingsGuard g = guard(fkb, new FakeNotes(),
                params(true, true, 0, now - 10L), now, 0L);
        g.setInstallHoldUntil(now - 5L);

        assertEquals(Verdict.REPAIRED, g.tick());
    }

    @Test
    public void installHoldDeadlineIsAbsolute_soShorteningTheDurationCannotCutItShort() {
        // The deadline is persisted, NOT the request timestamp. So dropping
        // watchdogKioskSettingsInstallHoldMs mid-install can't retroactively end a hold
        // that is already running — the stored deadline still governs.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        // Duration reconfigured to 0, but a deadline 5 min out is already stored.
        Params shortened = new Params(true, 60_000L, 0L, now + 300_000L, 0L, true);
        KioskSettingsGuard g = new KioskSettingsGuard(
                () -> shortened, () -> 0L, fkb, new FakeNotes(), () -> now);

        assertEquals(Verdict.INSTALL_HOLD, g.tick());
        assertTrue(fkb.writes.isEmpty());
    }

    @Test
    public void disarmed_readsNothingAndWritesNothing() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        Verdict v = guard(fkb, new FakeNotes(), params(true, true, now + 60_000L, 900_000L),
                now, 0L).tick();

        assertEquals(Verdict.DISARMED, v);
        assertEquals(0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    @Test
    public void disarmExpires_andTheGuardResumes() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;

        Verdict v = guard(fkb, new FakeNotes(), params(true, true, now - 1L, 900_000L), now, 0L).tick();

        assertEquals(Verdict.REPAIRED, v);
    }

    @Test
    public void disabled_readsNothingAndWritesNothing() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");

        Verdict v = guard(fkb, new FakeNotes(), params(false, true, 0, 900_000L), 1_000_000L, 0L).tick();

        assertEquals(Verdict.DISABLED, v);
        assertEquals(0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    @Test
    public void emptyPassword_readsNothing_andLogsExactlyOnceAcrossManyTicks() {
        // A permanently unconfigured device ticks every 60s forever. One note total —
        // the durable log is head-truncated at 128KB, so a per-tick note would evict
        // the real history.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        FakeNotes notes = new FakeNotes();
        KioskSettingsGuard g = guard(fkb, notes, params(true, false, 0, 900_000L), 1_000_000L, 0L);

        for (int i = 0; i < 50; i++) {
            assertEquals(Verdict.NO_PASSWORD, g.tick());
        }

        assertEquals(0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
        assertEquals("the empty-password note must fire once, not every tick",
                1, notes.countContaining("KIOSKSET"));
    }

    @Test
    public void readFailure_writesNothing() {
        // FkbRest.listSettings returns an empty map on unreachable/auth-failure. That
        // is "unknown", and must never be repaired as if all 11 settings drifted.
        FakeFkb fkb = new FakeFkb();
        fkb.live = Collections.emptyMap();

        Verdict v = guard(fkb, new FakeNotes(), params(true, true, 0, 900_000L), 1_000_000L, 0L).tick();

        assertEquals(Verdict.UNREACHABLE, v);
        assertEquals(1, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    // --- force check ------------------------------------------------------
    //
    // The asymmetry these assert: a force check BYPASSES the install hold but is still
    // refused by an explicit disarm. See KioskSettingsGuard.runPass for the reasoning.

    @Test
    public void forceCheck_bypassesAnActiveInstallHold() {
        // Exactly the deploy-verification case: an /update landed seconds ago, so the
        // ordinary tick is standing down, but the operator has asked for a check NOW.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;
        // A PERSISTED deadline — i.e. the hold also survives a restart, and the force
        // check must still be able to punch through it.
        KioskSettingsGuard g = guard(fkb, new FakeNotes(), params(true, true, 0, now + 895_000L),
                now, now - 5_000L);

        // The scheduled tick refuses, as it must — it would abort an install in flight.
        assertEquals(Verdict.INSTALL_HOLD, g.tick());
        assertEquals(0, fkb.reads);

        KioskSettingsGuard.Pass p = g.runPass(true);
        assertEquals(Verdict.REPAIRED, p.verdict);
        assertEquals(java.util.Collections.singletonList("kioskMode"), p.drifted);
        assertEquals(java.util.Collections.singletonList("kioskMode"), p.repaired);
        assertTrue(fkb.writes.contains("bool:kioskMode=true"));
    }

    @Test
    public void forceCheck_isStillRefusedWhileDisarmed() {
        // A disarm is a human saying "leave me alone"; a force check must not override
        // it. Only the install hold — an INFERENCE — is bypassable.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        long now = 1_000_000L;
        KioskSettingsGuard g = guard(fkb, new FakeNotes(), params(true, true, now + 60_000L, 900_000L),
                now, 0L);

        KioskSettingsGuard.Pass p = g.runPass(true);
        assertEquals(Verdict.DISARMED, p.verdict);
        assertEquals(0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
        assertTrue(p.repaired.isEmpty());
    }

    @Test
    public void forceCheck_isStillRefusedWhileDisabled() {
        // Same reasoning as disarm: watchdogKioskSettingsEnabled=false is an explicit
        // human setting, not an inference.
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        KioskSettingsGuard g = guard(fkb, new FakeNotes(), params(false, true, 0, 900_000L),
                1_000_000L, 0L);

        assertEquals(Verdict.DISABLED, g.runPass(true).verdict);
        assertEquals(0, fkb.reads);
        assertTrue(fkb.writes.isEmpty());
    }

    @Test
    public void forceCheck_reportsDriftedAndRepairedKeysSeparately() {
        // They diverge when a write fails, which is what makes reporting both useful.
        FakeFkb fkb = new FakeFkb() {
            @Override public boolean setString(String key, String value) {
                super.setString(key, value);
                return false;   // FKB rejected it
            }
        };
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");         // bool  — will succeed
        fkb.live.put("reloadPageFailure", "0");     // string — will fail
        KioskSettingsGuard g = guard(fkb, new FakeNotes(), params(true, true, 0, 900_000L),
                1_000_000L, 0L);

        KioskSettingsGuard.Pass p = g.runPass(true);
        assertEquals(2, p.drifted.size());
        assertEquals("only the successful write counts as repaired",
                java.util.Collections.singletonList("kioskMode"), p.repaired);
    }

    @Test
    public void forceCheck_onACleanKioskReportsOkAndRepairsNothing() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        KioskSettingsGuard g = guard(fkb, new FakeNotes(), params(true, true, 0, 900_000L),
                1_000_000L, 0L);

        KioskSettingsGuard.Pass p = g.runPass(true);
        assertEquals(Verdict.OK, p.verdict);
        assertTrue(p.drifted.isEmpty());
        assertTrue(p.repaired.isEmpty());
        assertTrue(fkb.writes.isEmpty());
    }

    // --- observability ----------------------------------------------------

    @Test
    public void snapshotTracksVerdictDriftCountAndRepairsSinceBoot() {
        FakeFkb fkb = new FakeFkb();
        fkb.live = healthy();
        fkb.live.put("kioskMode", "false");
        KioskSettingsGuard g = guard(fkb, new FakeNotes(), params(true, true, 0, 900_000L),
                1_000_000L, 0L);

        g.tick();                       // repairs kioskMode (the fake applies the write)
        assertEquals(Verdict.OK, g.tick()); // second pass is clean

        org.json.JSONObject s = g.snapshot();
        assertEquals("OK", s.optString("verdict"));
        assertEquals(0, s.optInt("lastDriftCount"));
        assertEquals(1, s.optJSONObject("repairsSinceBoot").optInt("kioskMode"));
        assertEquals(1_000_000L, s.optLong("lastCheckAtMs"));
    }
}
