package net.kckern.daylight.cap.lockdown;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/** Which packages owner mode hides. Pure Java. */
final class OwnerHide {
    private static final Pattern PACKAGE = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+");

    private OwnerHide() { }

    /**
     * The exact package names in the list, without this app and without the package that
     * provides the WebView: hiding that one would leave the kiosk with nothing to draw
     * its page (portal-keys' KioskPolicy made the same exception for the browser).
     */
    static List<String> packages(String csv, String ownPackage, String webViewPackage) {
        List<String> out = new ArrayList<>();
        if (csv == null) return out;
        for (String raw : csv.split(",")) {
            String p = raw.trim();
            if (p.isEmpty() || !PACKAGE.matcher(p).matches()) continue;
            if (p.equals(ownPackage) || p.equals(webViewPackage) || out.contains(p)) continue;
            out.add(p);
        }
        return out;
    }
}
