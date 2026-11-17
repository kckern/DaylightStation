package net.kckern.portalkeys.api;

import java.io.File;

public interface ShellServices {
    Object context();
    Object accessibilityService();
    int shellVersionCode();
    String adminToken();
    File payloadDir();
    String requestPayloadSwap(String url, String sha256);
    String requestPayloadRollback();
    String payloadStatusJson();
    /** Read-only native authority. Old shells are unknown and cannot authorize recovery. */
    default String pageSafetySnapshot() { return "{\"known\":false}"; }
    void note(String kind, String message);
}
