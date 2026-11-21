package net.kckern.daylight.cap.widgets.shell;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

/** Small private covers the launcher can display without a network request. */
final class PlaylistWidgetArtwork {
    private PlaylistWidgetArtwork() {}

    private static File cover(Context context, String playlist) {
        java.util.UUID key = java.util.UUID.nameUUIDFromBytes(
                playlist.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return new File(context.getFilesDir(), "playlist-cover-" + key);
    }

    static Bitmap read(Context context, String playlist) {
        File file = cover(context, playlist);
        return file.isFile() ? BitmapFactory.decodeFile(file.getPath()) : null;
    }

    static void save(Context context, String playlist, Bitmap bitmap) {
        File file = cover(context, playlist);
        if (file.isFile()) return;
        AtomicFile atomic = new AtomicFile(file);
        FileOutputStream stream = null;
        Bitmap scaled = bitmap;
        try {
            float ratio = 240f / Math.max(bitmap.getWidth(), bitmap.getHeight());
            if (ratio < 1) scaled = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(bitmap.getWidth() * ratio)),
                    Math.max(1, Math.round(bitmap.getHeight() * ratio)), true);
            stream = atomic.startWrite();
            if (scaled.compress(Bitmap.CompressFormat.JPEG, 84, stream)) atomic.finishWrite(stream);
            else atomic.failWrite(stream);
        } catch (IOException failure) {
            atomic.failWrite(stream);
        } finally {
            if (scaled != bitmap) scaled.recycle();
        }
    }
}
