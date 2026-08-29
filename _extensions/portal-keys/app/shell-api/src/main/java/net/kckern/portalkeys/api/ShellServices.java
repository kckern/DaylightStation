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
    void note(String kind, String message);
}
