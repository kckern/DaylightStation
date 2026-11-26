package net.kckern.daylight.cap.mediaservice;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Locale;
import java.util.UUID;

/**
 * Who this install is, to the backend's inbox. A device id names the household's phone;
 * an install id names this one installation of it (random, kept in the payload's state, new
 * after a reinstall or a cleared app), so a command addressed to it never reaches another
 * copy of the app. An emulator never takes the phone's inbox: it polls as
 * "&lt;device id&gt;-emulator". Pure apart from the one file.
 */
final class InboxIdentity {
    private InboxIdentity() { }

    static final java.util.regex.Pattern INSTALL = java.util.regex.Pattern.compile("[a-f0-9-]{36}");

    /** This install's id, made once and kept in {@code stateDir}/install-id. */
    static synchronized String installId(File stateDir) {
        File f = new File(stateDir, "install-id");
        try {
            if (f.isFile()) {
                String id = new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8).trim();
                if (INSTALL.matcher(id).matches()) return id;
            }
            String id = UUID.randomUUID().toString();
            //noinspection ResultOfMethodCallIgnored
            stateDir.mkdirs();
            Files.write(f.toPath(), id.getBytes(StandardCharsets.UTF_8));
            return id;
        } catch (Exception unwritable) {
            // Not kept: a fresh id each start is still never another install's.
            return UUID.randomUUID().toString();
        }
    }

    /** An Android emulator (the SDK images), from Build fields. */
    static boolean emulator(String fingerprint, String hardware, String product, String model) {
        String f = lower(fingerprint), h = lower(hardware), p = lower(product), m = lower(model);
        return f.startsWith("generic") || f.contains("/sdk_gphone") || f.contains("emulator")
                || h.equals("ranchu") || h.equals("goldfish")
                || p.startsWith("sdk_gphone") || p.contains("emulator") || p.equals("sdk")
                || m.contains("android sdk built for") || m.startsWith("sdk_gphone");
    }

    /** The id this install polls and is addressed as: the device's own, or its emulator twin. */
    static String inboxDeviceId(String deviceId, boolean emulator) {
        if (deviceId == null || deviceId.isEmpty()) return deviceId;
        return emulator ? deviceId + "-emulator" : deviceId;
    }

    /** The model as a short query value. */
    static String model(String model) {
        String m = model == null ? "" : model.trim();
        return m.length() > 64 ? m.substring(0, 64) : m;
    }

    private static String lower(String s) { return s == null ? "" : s.toLowerCase(Locale.ROOT); }
}
