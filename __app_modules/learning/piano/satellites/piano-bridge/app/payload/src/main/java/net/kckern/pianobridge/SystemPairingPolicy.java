package net.kckern.pianobridge;

import java.util.Locale;
import java.util.regex.Pattern;

/** Pure, fail-closed policy for the one system dialog delegated from an explicit pairing reply. */
final class SystemPairingPolicy {
    private SystemPairingPolicy() { }

    static String confirmationMode(boolean privileged, boolean enabled, boolean accessibilityBound) {
        return privileged ? "native" : enabled && accessibilityBound ? "system-dialog" : "unsupported";
    }

    static boolean ownsDelegatedRequest(String requestedAddress, long requestExpiry,
                                       String delegatedAddress, long delegationExpiry, long now) {
        return BluetoothController.ownsPairingRequest(requestedAddress, requestExpiry, delegatedAddress, now)
                && delegationExpiry > now && delegationExpiry <= requestExpiry;
    }

    static boolean matchesDialog(String packageName, String titles, String visibleTexts,
                                 String expectedName, String expectedAddress, String positiveLabel) {
        if (!"com.android.settings".equals(packageName) || !"pair".equals(normalize(positiveLabel))
                || titles == null || visibleTexts == null) return false;
        String name = unquote(normalize(expectedName));
        String address = normalize(expectedAddress);
        boolean pairingTitle = false;
        boolean deviceIdentity = false;
        for (String value : titles.split("\\n")) {
            String title = normalize(value);
            if ("bluetooth pairing request".equals(title) || "bluetooth pairing".equals(title)
                    || "pairing request".equals(title) || pairWith(title, name, address)) pairingTitle = true;
            // A generic dialog heading must not stand in for a device with the same name.
            if (pairWith(title, name, address)) deviceIdentity = true;
        }
        for (String value : visibleTexts.split("\\n"))
            if (identity(normalize(value), name, address)) deviceIdentity = true;
        return pairingTitle && deviceIdentity;
    }

    static boolean isIdentityText(String resourceId, boolean heading, String className) {
        if (heading || resourceId != null && (resourceId.endsWith("/alertTitle")
                || resourceId.endsWith("/title") || resourceId.endsWith("/button1")
                || resourceId.endsWith("/button2") || resourceId.endsWith("/button3"))) return false;
        return className == null || !className.endsWith("Button");
    }

    private static boolean identity(String value, String name, String address) {
        if (!name.isEmpty() && unquote(value).equals(name) || pairWith(value, name, address)) return true;
        // MACs can appear in a labeled node, but must not be a prefix of another address/token.
        return !address.isEmpty() && Pattern.compile("(?<![a-z0-9:])" + Pattern.quote(address) + "(?![a-z0-9:])")
                .matcher(value).find();
    }

    private static boolean pairWith(String value, String name, String address) {
        if (!value.startsWith("pair with ") || !value.endsWith("?")) return false;
        String target = unquote(value.substring("pair with ".length(), value.length() - 1).trim());
        return !name.isEmpty() && name.equals(target) || !address.isEmpty() && address.equals(target);
    }

    private static String unquote(String value) {
        if (value.length() >= 2 && (value.charAt(0) == '"' && value.endsWith("\"")
                || value.charAt(0) == '\'' && value.endsWith("'")))
            return value.substring(1, value.length() - 1).trim();
        return value;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.replaceAll("[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]", "")
                .replace('\u2018', '\'').replace('\u2019', '\'').replace('\u201C', '"').replace('\u201D', '"')
                .replace('\u00A0', ' ').replaceAll("\\s+", " ").trim().toLowerCase(Locale.US);
    }
}
