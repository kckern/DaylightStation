package net.kckern.daylight.shellkit;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

/** Bounded decoding for HTTPS media artwork already vetted by the payload. */
public final class PlaylistArtwork {
    private PlaylistArtwork() {}

    public static Bitmap load(String thumbnail, int maxSide) {
        if (thumbnail == null || !thumbnail.startsWith("https://")) return null;
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
                    if (bytes.size() + count > 4 * 1024 * 1024) return null;
                    bytes.write(buffer, 0, count);
                }
                byte[] encoded = bytes.toByteArray();
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
        } catch (java.io.IOException ignored) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

}
