package net.kckern.daylight.cap.quickinput.shell;

import java.io.File;
import java.io.IOException;

/**
 * What becomes of a photo the camera took. Pure: the pixel work stands behind Pixels.
 *
 * A capture is never sent as the camera wrote it. It is decoded, turned upright, scaled
 * so its long edge is at most 2048 pixels and written again as a JPEG at quality 85.
 * Writing it again is what removes its EXIF: where it was taken, the phone that took it
 * and when. A photo's position must never leave the phone, so the written file is
 * checked for metadata (JpegCheck) and refused if any is found. The camera output
 * remains private until the draft store has committed a clean JPEG.
 *
 * The intake takes 15,728,640 bytes. A file over that is written again smaller, down a
 * short ladder; the last step fits whatever the picture is.
 */
final class PhotoPlan {
    /** The intake's limit for a photo. */
    static final long MAX_BYTES = 15_728_640L;

    /** One way of writing the photo: the long edge in pixels and the JPEG quality. */
    static final class Step {
        final int longEdge;
        final int quality;

        Step(int longEdge, int quality) {
            this.longEdge = longEdge;
            this.quality = quality;
        }
    }

    /** Tried in order until the file fits. The first is what is wanted; the rest exist for a picture that will not compress. */
    static final Step[] STEPS = { new Step(2048, 85), new Step(2048, 70), new Step(1536, 70), new Step(1024, 60) };

    /** How the pixels are turned to stand upright: clockwise by degrees, then mirrored left to right. */
    static final class Turn {
        final int degrees;
        final boolean mirror;

        Turn(int degrees, boolean mirror) {
            this.degrees = degrees;
            this.mirror = mirror;
        }
    }

    /** Decodes, turns, scales and writes a JPEG. The Android side of this is AndroidPixels. */
    interface Pixels {
        /** @return false when the capture is not a picture that can be read */
        boolean encode(File raw, File out, Step step) throws Exception;
    }

    enum Preparation {
        READY(""),
        UNREADABLE("The camera output could not be decoded. Retake the photo."),
        OUTPUT_WRITE("Could not write the prepared photo. Try again."),
        TOO_LARGE("The photo is still too large after resizing. Retake it."),
        PRIVACY_CHECK("The JPEG did not pass the format and privacy check. Retake the photo."),
        NOT_ENOUGH_MEMORY("There was not enough memory to prepare the photo. Try again."),
        PROCESSING_FAILED("Photo processing failed. Try again or retake it."),
        DRAFT_STORAGE("Could not save the prepared photo in the draft. Try again.");

        final String message;
        Preparation(String message) { this.message = message; }
    }

    interface OrientationReader { int read() throws IOException; }

    static final class WriteFailure extends IOException { }

    private PhotoPlan() { }

    /** Whether the camera left a photo: it said so, and wrote something. A cancelled capture is nothing, whatever was written. */
    static boolean captured(boolean resultOk, long rawBytes) { return resultOk && rawBytes > 0; }

    /** The size to scale to: the long edge at most longEdge, the shape kept, never enlarged. */
    static int[] target(int width, int height, int longEdge) {
        int longest = Math.max(width, height);
        if (longest <= longEdge) return new int[] { width, height };
        long w = Math.round((double) width * longEdge / longest);
        long h = Math.round((double) height * longEdge / longest);
        return new int[] { (int) Math.max(1, w), (int) Math.max(1, h) };
    }

    /** The power of two to decode at: the largest that leaves the long edge at or over longEdge. */
    static int sampleSize(int width, int height, int longEdge) {
        int longest = Math.max(width, height);
        int sample = 1;
        while (longest / (sample * 2) >= longEdge) sample *= 2;
        return sample;
    }

    /** The turn for an EXIF orientation value (1 to 8). Anything else is left as it is. */
    static Turn turn(int exifOrientation) {
        switch (exifOrientation) {
            case 2: return new Turn(0, true);
            case 3: return new Turn(180, false);
            case 4: return new Turn(180, true);
            case 5: return new Turn(90, true);
            case 6: return new Turn(90, false);
            case 7: return new Turn(270, true);
            case 8: return new Turn(270, false);
            default: return new Turn(0, false);
        }
    }

    /** Orientation is optional. A broken tag does not make the image pixels unreadable. */
    static int readOrientation(OrientationReader reader) {
        try {
            return reader.read();
        } catch (IOException | RuntimeException unreadableTag) {
            return 1;
        }
    }

    /** Prepare a privacy-checked JPEG. The confirmed source stays private on failure. */
    static Preparation prepare(File raw, File out, Pixels pixels) {
        Preparation result = prepareOutput(raw, out, pixels);
        if (result != Preparation.READY) out.delete();
        return result;
    }

    private static Preparation prepareOutput(File raw, File out, Pixels pixels) {
        try {
            for (Step step : STEPS) {
                if (!pixels.encode(raw, out, step)) return Preparation.UNREADABLE;
                long bytes = out.length();
                if (bytes <= 0) return Preparation.OUTPUT_WRITE;
                if (bytes > MAX_BYTES) continue;
                return JpegCheck.clean(out) ? Preparation.READY : Preparation.PRIVACY_CHECK;
            }
            return Preparation.TOO_LARGE;
        } catch (WriteFailure failed) {
            return Preparation.OUTPUT_WRITE;
        } catch (OutOfMemoryError failed) {
            return Preparation.NOT_ENOUGH_MEMORY;
        } catch (Exception failed) {
            return Preparation.PROCESSING_FAILED;
        }
    }
}
