package net.kckern.daylight.core.testing;

import net.kckern.daylight.api.ShellServices;

import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class FakeShell implements ShellServices {
    public static final String TOKEN = "0123456789abcdef0123456789abcdef";
    public final File dir;
    public final List<String> notes = new ArrayList<>();
    public final Map<String, Object> components = new HashMap<>();
    public String payloadStatus = "{\"current\":\"test.jar\"}";

    public FakeShell(File dir) { this.dir = dir; }

    @Override public Object context() { return null; }
    @Override public String deviceId() { return "test"; }
    @Override public int shellVersionCode() { return 7; }
    @Override public String controlToken() { return TOKEN; }
    @Override public File payloadDir() { return dir; }
    @Override public Object component(String name) { return components.get(name); }
    @Override public void updateNotification(String text) { }
    @Override public String requestPayloadSwap(String url, String sha256) { return "queued"; }
    @Override public String requestPayloadRollback() { return "queued"; }
    @Override public String payloadStatusJson() { return payloadStatus; }
    @Override public void note(String kind, String message) { notes.add(kind + " " + message); }
}
