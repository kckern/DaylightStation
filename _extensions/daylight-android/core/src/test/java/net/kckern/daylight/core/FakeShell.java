package net.kckern.daylight.core;

import net.kckern.daylight.api.ShellServices;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

final class FakeShell implements ShellServices {
    static final String TOKEN = "0123456789abcdef0123456789abcdef";
    final File dir;
    final List<String> notes = new ArrayList<>();

    FakeShell(File dir) { this.dir = dir; }

    @Override public Object context() { return null; }
    @Override public String deviceId() { return "test"; }
    @Override public int shellVersionCode() { return 7; }
    @Override public String controlToken() { return TOKEN; }
    @Override public File payloadDir() { return dir; }
    @Override public Object component(String name) { return null; }
    @Override public void updateNotification(String text) { }
    @Override public String requestPayloadSwap(String url, String sha256) { return "queued"; }
    @Override public String requestPayloadRollback() { return "queued"; }
    @Override public String payloadStatusJson() { return "{\"current\":\"test.jar\"}"; }
    @Override public void note(String kind, String message) { notes.add(kind + " " + message); }
}
