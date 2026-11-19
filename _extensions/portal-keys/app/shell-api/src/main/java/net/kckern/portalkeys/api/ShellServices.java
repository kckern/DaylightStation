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
    /** Returns null on an older shell that has no shared lockdown authority. */
    default LockdownReply applyLockdown(String token, String body) { return null; }

    final class LockdownReply {
        public final int status;
        public final String body;

        public LockdownReply(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    void note(String kind, String message);
}
