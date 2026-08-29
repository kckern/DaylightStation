package net.kckern.portalkeys.payload;

import android.content.Context;
import android.content.SharedPreferences;
import java.util.LinkedHashSet;
import java.util.Set;

final class UsbHidConfig {
    private static final String PREFS = "portal_hid";
    private static final String KEY_ALLOW = "allow";
    private static final String SAYO = "8089:0008";
    private final SharedPreferences prefs;

    UsbHidConfig(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized boolean allowed(int vendorId, int productId) {
        return entries().contains(id(vendorId, productId));
    }

    synchronized Set<String> entries() {
        Set<String> stored = prefs.getStringSet(KEY_ALLOW, null);
        Set<String> result = new LinkedHashSet<>();
        result.add(SAYO);
        if (stored != null) result.addAll(stored);
        return result;
    }

    synchronized void allow(int vendorId, int productId) {
        Set<String> next = entries();
        next.add(id(vendorId, productId));
        prefs.edit().putStringSet(KEY_ALLOW, next).apply();
    }

    static String id(int vendorId, int productId) {
        return String.format(java.util.Locale.US, "%04x:%04x", vendorId, productId);
    }
}
