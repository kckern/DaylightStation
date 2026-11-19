package net.kckern.daylight.core;

import static org.junit.Assert.*;

import net.kckern.daylight.core.testing.TestCore;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class CoreConfigTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    @Test public void heartbeatIdentityFallsBackToTheDeviceId() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{}"));
        CoreConfig cfg = core.config();
        assertTrue(cfg.heartbeatEnabled());
        assertEquals(60000L, cfg.heartbeatIntervalMs());
        assertEquals("test", cfg.heartbeatDeviceId());
        assertEquals("daylight-test", cfg.logStoreApp());
        assertEquals("", cfg.heartbeatLogStoreUrl());
    }

    @Test public void aDeviceFileCanKeepTheOldLogStoreIdentity() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.prepare(new JSONObject("{\"logstore.app\":\"piano-bridge\",\"heartbeat.deviceId\":\"room-tablet\"}"));
        assertEquals("piano-bridge", core.config().logStoreApp());
        assertEquals("room-tablet", core.config().heartbeatDeviceId());
    }

    @Test public void beatIsNotReadyWithoutAnAndroidContext() throws Exception {
        CoreRuntime core = TestCore.create(tmp.newFolder());
        core.start(new JSONObject("{}"));
        JSONObject r = TestCore.get(core, "/beat");
        assertFalse(r.getBoolean("ok"));
        assertEquals("not_ready", r.getString("error"));
    }
}
