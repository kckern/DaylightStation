package net.kckern.daylight.cap.webviewhost;

import java.net.URI;

final class CallCapturePolicy {
    static boolean allows(String start, String page, String requester, boolean external) {
        String origin = OriginPolicy.originOf(start);
        if (external || origin == null || !origin.startsWith("https://")
                || !origin.equals(OriginPolicy.originOf(page))
                || !origin.equals(OriginPolicy.originOf(requester))) return false;
        try {
            String path = URI.create(page).getRawPath();
            return "/call".equals(path) || "/call/".equals(path);
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }
}
