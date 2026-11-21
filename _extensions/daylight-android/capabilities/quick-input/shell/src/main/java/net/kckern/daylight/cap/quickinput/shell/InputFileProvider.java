package net.kckern.daylight.cap.quickinput.shell;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands the system's camera app the one file it is to write a capture into.
 *
 * Not exported: no other app can reach it by itself. The photo screen grants the
 * camera app access to one URI, content://<package>.inputs/capture/<id>.<dest>.raw.part,
 * for the length of the capture, and the manifest allows grants for /capture/ only.
 * What a URI may name is CaptureFiles.served: a capture file by its exact name, opened
 * for writing. A finished photo, typed text, a recording and every other file of the
 * app are not served, whatever the path says.
 *
 * It has no rows: nothing can be inserted, changed or deleted through it.
 */
public class InputFileProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }

    private File fileFor(Uri uri) {
        String name = uri == null ? null : CaptureFiles.served(uri.getPathSegments());
        if (name == null || getContext() == null) return null;
        return new File(new File(getContext().getFilesDir(), CaptureDraftStore.CAMERA_DIR), name);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = fileFor(uri);
        if (file == null || !file.isFile() || !CaptureFiles.modeAllowed(mode)) throw new FileNotFoundException("not served");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.parseMode(mode) & ~ParcelFileDescriptor.MODE_CREATE);
    }

    @Override public String getType(Uri uri) { return fileFor(uri) == null ? null : "image/jpeg"; }

    /** The name and size of a capture file, which some camera apps ask for before they write. Nothing else. */
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = fileFor(uri);
        if (file == null) return null;
        MatrixCursor cursor = new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, 1);
        cursor.addRow(new Object[] { "photo.jpg", file.length() });
        return cursor;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("read-only"); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
