package net.kckern.daylight.shellkit;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.File;
import java.nio.file.Files;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/**
 * Bounded decoding for HTTPS media artwork already vetted by the payload. Covers of
 * collections kept on this phone are also saved in a folder ({@link #useKept}), read
 * before the network, so a downloaded book or album shows its cover offline.
 */
public final class PlaylistArtwork {
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private static volatile File keptDir;

    private PlaylistArtwork() {}

    /** Where kept covers live (files/kept-art). Every screen that shows covers sets it. */
    public static void useKept(File dir) { keptDir = dir; }

    public static Bitmap load(String thumbnail, int maxSide) {
        if (thumbnail == null || !thumbnail.startsWith("https://")) return null;
        byte[] encoded = keptBytes(thumbnail);
        if (encoded == null) encoded = fetch(thumbnail);
        return encoded == null ? null : decode(encoded, maxSide);
    }

    /** Saves the cover at {@code thumbnail} for offline use. False when it could not be fetched. */
    public static boolean keep(String thumbnail) {
        File dir = keptDir;
        if (dir == null || thumbnail == null || !thumbnail.startsWith("https://")) return false;
        if (new File(dir, name(thumbnail)).isFile()) return true;
        byte[] encoded = fetch(thumbnail);
        if (encoded == null) return false;
        try {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            Files.write(new File(dir, name(thumbnail)).toPath(), encoded);
            return true;
        } catch (java.io.IOException notSaved) {
            return false;
        }
    }

    /** Deletes saved covers other than {@code wanted} (covers of collections no longer kept). */
    public static void keepOnly(Collection<String> wanted) {
        File dir = keptDir;
        File[] files = dir == null ? null : dir.listFiles();
        if (files == null) return;
        Set<String> names = new HashSet<>();
        for (String url : wanted) if (url != null) names.add(name(url));
        for (File f : files) if (!names.contains(f.getName())) //noinspection ResultOfMethodCallIgnored
            f.delete();
    }

    /** A cover URL as a file name: its hash, so no URL text reaches the disk name. */
    static String name(String url) {
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256").digest(url.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < 16; i++) s.append(String.format("%02x", d[i]));
            return s + ".img";
        } catch (java.security.NoSuchAlgorithmException impossible) {
            return Integer.toHexString(url.hashCode()) + ".img";
        }
    }

    private static byte[] keptBytes(String url) {
        File dir = keptDir;
        if (dir == null) return null;
        File f = new File(dir, name(url));
        try { return f.isFile() && f.length() <= MAX_BYTES ? Files.readAllBytes(f.toPath()) : null; }
        catch (java.io.IOException unreadable) { return null; }
    }

    private static byte[] fetch(String thumbnail) {
        javax.net.ssl.HttpsURLConnection connection = null;
        try {
            connection = (javax.net.ssl.HttpsURLConnection) new java.net.URL(thumbnail).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setInstanceFollowRedirects(false);
            if (connection.getResponseCode() != 200) return null;
            try (java.io.InputStream input = connection.getInputStream();
                    java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                for (int count; (count = input.read(buffer)) != -1;) {
                    if (bytes.size() + count > MAX_BYTES) return null;
                    bytes.write(buffer, 0, count);
                }
                return bytes.toByteArray();
            }
        } catch (java.io.IOException ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static Bitmap decode(byte[] encoded, int maxSide) {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) return null;
        options.inJustDecodeBounds = false;
        options.inSampleSize = 1;
        while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > maxSide) {
            options.inSampleSize *= 2;
        }
        return BitmapFactory.decodeByteArray(encoded, 0, encoded.length, options);
    }
}
