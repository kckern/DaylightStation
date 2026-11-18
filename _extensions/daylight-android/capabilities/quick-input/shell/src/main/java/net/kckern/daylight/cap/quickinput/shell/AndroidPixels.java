package net.kckern.daylight.cap.quickinput.shell;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;

import java.io.File;
import java.io.FileOutputStream;

/**
 * The pixel work of a photo: decode, turn upright, scale, write as JPEG. Every decision
 * (the size, the turn, the quality) is PhotoPlan's. Not covered by JVM tests: it needs
 * Android's decoder.
 *
 * Bitmap.compress writes the picture and no EXIF, so the written file holds nothing of
 * where or when the photo was taken. PhotoPlan checks that afterwards.
 */
final class AndroidPixels implements PhotoPlan.Pixels {
    @Override public boolean encode(File raw, File out, PhotoPlan.Step step) throws Exception {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(raw.getPath(), bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false;
        // Read before the camera's file is gone: the orientation is the one thing of its EXIF that is used.
        int orientation = new ExifInterface(raw.getPath()).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        PhotoPlan.Turn turn = PhotoPlan.turn(orientation);

        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = PhotoPlan.sampleSize(bounds.outWidth, bounds.outHeight, step.longEdge);
        Bitmap decoded;
        try {
            decoded = BitmapFactory.decodeFile(raw.getPath(), options);
        } catch (OutOfMemoryError tooBig) {
            // Half the size again. The long edge may then be under the step's, which is still a photo.
            options.inSampleSize *= 2;
            decoded = BitmapFactory.decodeFile(raw.getPath(), options);
        }
        if (decoded == null) return false;
        Bitmap upright = null;
        try {
            int[] size = PhotoPlan.target(decoded.getWidth(), decoded.getHeight(), step.longEdge);
            Matrix m = new Matrix();
            m.postScale((float) size[0] / decoded.getWidth(), (float) size[1] / decoded.getHeight());
            if (turn.degrees != 0) m.postRotate(turn.degrees);
            if (turn.mirror) m.postScale(-1, 1);
            upright = Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), m, true);
            try (FileOutputStream stream = new FileOutputStream(out)) {
                if (!upright.compress(Bitmap.CompressFormat.JPEG, step.quality, stream)) return false;
                stream.getFD().sync();
            }
            return true;
        } finally {
            if (upright != null && upright != decoded) upright.recycle();
            decoded.recycle();
        }
    }
}
