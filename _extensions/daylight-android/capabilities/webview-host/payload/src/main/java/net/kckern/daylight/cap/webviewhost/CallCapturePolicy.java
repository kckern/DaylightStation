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
    static boolean finishesBarcode(String device, String start, String launch, String current,
                                   String requester, boolean mainFrame, boolean external) {
        return "phone".equals(device) && mainFrame && allowsBarcode(start, launch, requester, external)
                && "/health".equals(path(current))
                && OriginPolicy.originOf(start).equals(OriginPolicy.originOf(current));
    }

    static boolean serviceRoot(String launch, String current) {
        String origin = OriginPolicy.originOf(launch);
        String path = path(launch);
        return origin != null && origin.equals(OriginPolicy.originOf(current)) && path != null
                && path.equals(path(current)) && ("/health".equals(path) || "/home".equals(path)
                || "/media".equals(path) || "/life/log".equals(path) || "/call".equals(path));
    }

    private static String path(String url) {
        try { return url == null ? null : URI.create(url).getRawPath(); }
        catch (IllegalArgumentException invalid) { return null; }
    }

    static boolean allowsBarcode(String start, String page, String requester, boolean external) {
        String origin = OriginPolicy.originOf(start);
        if (external || origin == null || !origin.startsWith("https://")
                || !origin.equals(OriginPolicy.originOf(page))
                || !origin.equals(OriginPolicy.originOf(requester))) return false;
        try {
            URI url = URI.create(page);
            return "/health".equals(url.getRawPath()) && "capture=barcode".equals(url.getRawQuery());
        } catch (IllegalArgumentException invalid) {
            return false;
        }
    }
}
