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
 * before the network, so a downloaded book or album shows its cover offline. Every
 * decoded cover is held in one process-wide memory cache (by URL and size, see
 * CoverCache): {@link #cached} answers on the main thread, so a cover one screen showed
 * draws on the next in the same frame instead of starting blank and popping in.
 */
public final class PlaylistArtwork {
    private static final int MAX_BYTES = 4 * 1024 * 1024;
    private static volatile File keptDir;

    private PlaylistArtwork() {}

    /** Where kept covers live (files/kept-art). Every screen that shows covers sets it. */
    public static void useKept(File dir) { keptDir = dir; }

    /**
     * The cover at {@code thumbnail}, at most {@code maxSide} pixels on its long side: from
     * memory, then the kept folder, then the network. Off the main thread. A cover that
     * failed is not fetched again until its backoff passes (offline, a dead link): the
     * caller gets null at once instead of a 4 s connect per cover on every draw.
     */
    public static Bitmap load(String thumbnail, int maxSide) {
        if (thumbnail == null || !thumbnail.startsWith("https://")) return null;
        Bitmap hit = cached(thumbnail, maxSide);
        if (hit != null) return hit;
        byte[] encoded = keptBytes(thumbnail);
        if (encoded == null) {
            long now = System.currentTimeMillis();
            long[] f = FAILED.get(thumbnail);
            if (!CoverCache.mayTry(f, now)) return null;
            encoded = fetch(thumbnail);
            if (encoded == null) {
                FAILED.put(thumbnail, CoverCache.failedAgain(f, now));
                return null;
            }
            FAILED.remove(thumbnail);
        }
        Bitmap b = decode(encoded, maxSide);
        if (b != null) remember(thumbnail, maxSide, b);
        return b;
    }

    /**
     * The cover already decoded in this process for {@code url} at {@code maxSide} or larger,
     * or null. No disk and no network: a screen calls this on the main thread before posting
     * work, so a cover seen on one screen draws on the next in the same frame.
     */
    public static Bitmap cached(String url, int maxSide) {
        if (url == null || url.isEmpty()) return null;
        android.util.LruCache<String, Bitmap> memory = memory();
        if (memory == null) return null;
        Integer size = CoverCache.pick(sizesOf(url), maxSide, false);
        Bitmap b = size == null ? null : memory.get(CoverCache.key(url, size));
        if (b == null && size != null) forget(url, size);
        return b;
    }

    /**
     * Any decoded copy of {@code url}, the largest there is, even one smaller than wanted: a
     * screen draws it at once and replaces it when the full size is decoded (Now playing,
     * opened on a cover the list just showed).
     */
    public static Bitmap cachedAny(String url, int maxSide) {
        Bitmap exact = cached(url, maxSide);
        if (exact != null || url == null || url.isEmpty()) return exact;
        android.util.LruCache<String, Bitmap> memory = memory();
        Integer size = memory == null ? null : CoverCache.pick(sizesOf(url), maxSide, true);
        return size == null ? null : memory.get(CoverCache.key(url, size));
    }

    // ── the process-wide memory cache ───────────────────────────────────────

    private static volatile android.util.LruCache<String, Bitmap> memory;
    /** The sizes decoded per URL, so a lookup finds a larger copy than asked for. */
    private static final java.util.Map<String, java.util.Set<Integer>> SIZES = new java.util.concurrent.ConcurrentHashMap<>();

    private static android.util.LruCache<String, Bitmap> memory() {
        android.util.LruCache<String, Bitmap> m = memory;
        if (m != null) return m;
        synchronized (PlaylistArtwork.class) {
            if (memory == null) {
                memory = new android.util.LruCache<String, Bitmap>(CoverCache.budgetBytes(Runtime.getRuntime().maxMemory())) {
                    @Override protected int sizeOf(String key, Bitmap value) { return Math.max(1, value.getAllocationByteCount()); }
                    @Override protected void entryRemoved(boolean evicted, String key, Bitmap old, Bitmap now) {
                        if (now == null) {
                            String[] parts = CoverCache.split(key);
                            if (parts != null) forget(parts[0], Integer.parseInt(parts[1]));
                        }
                    }
                };
            }
            return memory;
        }
    }

    private static java.util.Set<Integer> sizesOf(String url) {
        java.util.Set<Integer> s = SIZES.get(url);
        return s == null ? java.util.Collections.emptySet() : s;
    }

    private static void remember(String url, int maxSide, Bitmap b) {
        android.util.LruCache<String, Bitmap> m = memory();
        if (m == null) return;
        int size = CoverCache.bucket(maxSide);
        SIZES.computeIfAbsent(url, u -> java.util.concurrent.ConcurrentHashMap.newKeySet()).add(size);
        m.put(CoverCache.key(url, size), b);
    }

    private static void forget(String url, int size) {
        java.util.Set<Integer> s = SIZES.get(url);
        if (s == null) return;
        s.remove(size);
        if (s.isEmpty()) SIZES.remove(url, s);
    }

    /** Covers that failed: the next try waits a minute, doubling to a day, so a dead link is not fetched forever. */
    private static final java.util.Map<String, long[]> FAILED = new java.util.concurrent.ConcurrentHashMap<>();

    /** When a cover that failed {@code failures} times (last at {@code at}) may be tried again. */
    static long nextTry(int failures, long at) { return CoverCache.nextTry(failures, at); }

    /**
     * Saves the cover at {@code thumbnail} for offline use (https only, following https
     * redirects, written beside and renamed). False when it could not be fetched; a failed
     * cover is not tried again until its backoff passes.
     */
    public static boolean keep(String thumbnail) {
        File dir = keptDir;
        if (dir == null || thumbnail == null || !thumbnail.startsWith("https://")) return false;
        File target = new File(dir, name(thumbnail));
        if (target.isFile()) return true;
        long now = System.currentTimeMillis();
        long[] f = FAILED.get(thumbnail);
        if (!CoverCache.mayTry(f, now)) return false;
        byte[] encoded = fetchFollowing(thumbnail, 3);
        if (encoded == null) {
            FAILED.put(thumbnail, CoverCache.failedAgain(f, now));
            return false;
        }
        FAILED.remove(thumbnail);
        try {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File tmp = new File(dir, target.getName() + ".tmp");
            Files.write(tmp.toPath(), encoded);
            if (!tmp.renameTo(target)) Files.write(target.toPath(), encoded);
            return true;
        } catch (java.io.IOException notSaved) {
            return false;
        }
    }

    /** A cover fetch that follows up to {@code hops} https redirects (a CDN's), never to http. */
    private static byte[] fetchFollowing(String url, int hops) {
        String at = url;
        for (int i = 0; i <= hops; i++) {
            javax.net.ssl.HttpsURLConnection c = null;
            try {
                c = (javax.net.ssl.HttpsURLConnection) new java.net.URL(at).openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(4000);
                c.setInstanceFollowRedirects(false);
                int code = c.getResponseCode();
                if (code >= 300 && code < 400) {
                    String next = c.getHeaderField("Location");
                    if (next == null) return null;
                    next = new java.net.URL(new java.net.URL(at), next).toString();
                    if (!next.startsWith("https://")) return null;
                    at = next;
                    continue;
                }
                if (code != 200) return null;
                try (java.io.InputStream input = c.getInputStream();
                        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    for (int count; (count = input.read(buffer)) != -1;) {
                        if (bytes.size() + count > MAX_BYTES) return null;
                        bytes.write(buffer, 0, count);
                    }
                    return bytes.toByteArray();
                }
            } catch (java.io.IOException | ClassCastException failed) {
                return null;
            } finally {
                if (c != null) c.disconnect();
            }
        }
        return null;
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
