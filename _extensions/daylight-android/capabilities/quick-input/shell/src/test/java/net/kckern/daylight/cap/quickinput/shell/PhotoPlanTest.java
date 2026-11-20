package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.File;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;

public class PhotoPlanTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    /** The intake's limit for a photo, and what the owner asked for: long edge 2048, quality 85. */
    @Test public void theFirstStepIsTheOneAskedFor() {
        assertEquals(15_728_640L, PhotoPlan.MAX_BYTES);
        assertEquals(2048, PhotoPlan.STEPS[0].longEdge);
        assertEquals(85, PhotoPlan.STEPS[0].quality);
    }

    @Test public void eachLaterStepIsSmallerSoALadderEndsUnderTheLimit() {
        for (int i = 1; i < PhotoPlan.STEPS.length; i++) {
            PhotoPlan.Step before = PhotoPlan.STEPS[i - 1], step = PhotoPlan.STEPS[i];
            assertTrue(step.longEdge <= before.longEdge && step.quality <= before.quality);
            assertTrue(step.longEdge < before.longEdge || step.quality < before.quality);
        }
        PhotoPlan.Step last = PhotoPlan.STEPS[PhotoPlan.STEPS.length - 1];
        assertTrue("even uncompressed, three bytes a pixel, the last step fits", (long) last.longEdge * last.longEdge * 3 < PhotoPlan.MAX_BYTES);
    }

    @Test public void aPhotoIsScaledSoItsLongEdgeIsAtMostTheStepsAndNeverEnlarged() {
        assertArrayEquals(new int[] { 2048, 1536 }, PhotoPlan.target(4000, 3000, 2048));
        assertArrayEquals(new int[] { 1536, 2048 }, PhotoPlan.target(3000, 4000, 2048));
        assertArrayEquals(new int[] { 2048, 1152 }, PhotoPlan.target(8160, 4590, 2048));
        assertArrayEquals("already small: left as it is", new int[] { 1600, 1200 }, PhotoPlan.target(1600, 1200, 2048));
        assertArrayEquals(new int[] { 2048, 2048 }, PhotoPlan.target(2048, 2048, 2048));
        assertArrayEquals("a sliver keeps at least one pixel", new int[] { 2048, 1 }, PhotoPlan.target(20000, 3, 2048));
        assertArrayEquals(new int[] { 1024, 768 }, PhotoPlan.target(4000, 3000, 1024));
    }

    /** Decoding at a power of two keeps memory down without going under the size that is wanted. */
    @Test public void theDecoderIsAskedForTheLargestPowerOfTwoThatStaysAtOrOverTheTarget() {
        assertEquals(1, PhotoPlan.sampleSize(4000, 3000, 2048));
        assertEquals(1, PhotoPlan.sampleSize(4095, 3000, 2048));
        assertEquals(2, PhotoPlan.sampleSize(4096, 3072, 2048));
        assertEquals(2, PhotoPlan.sampleSize(8160, 6120, 2048));
        assertEquals(4, PhotoPlan.sampleSize(8192, 6144, 2048));
        assertEquals(4, PhotoPlan.sampleSize(3000, 4096, 1024));
        assertEquals(1, PhotoPlan.sampleSize(640, 480, 2048));
        assertEquals("nothing sensible to decode", 1, PhotoPlan.sampleSize(0, 0, 2048));
    }

    /** Re-encoding drops the camera's orientation tag, so the pixels themselves are turned. */
    @Test public void theCamerasOrientationBecomesATurnOfThePixels() {
        int[][] table = { { 1, 0, 0 }, { 2, 0, 1 }, { 3, 180, 0 }, { 4, 180, 1 }, { 5, 90, 1 }, { 6, 90, 0 }, { 7, 270, 1 }, { 8, 270, 0 } };
        for (int[] row : table) {
            PhotoPlan.Turn t = PhotoPlan.turn(row[0]);
            assertEquals("orientation " + row[0], row[1], t.degrees);
            assertEquals("orientation " + row[0], row[2] == 1, t.mirror);
        }
        for (int unknown : new int[] { 0, 9, -1, 100 }) {
            assertEquals(0, PhotoPlan.turn(unknown).degrees);
            assertFalse(PhotoPlan.turn(unknown).mirror);
        }
    }

    // ── what becomes of a capture ────────────────────────────────────────────

    @Test public void aCancelledOrEmptyCaptureIsNothing() {
        assertFalse(PhotoPlan.captured(false, 0));
        assertFalse("cancelled after the camera wrote something: still cancelled", PhotoPlan.captured(false, 4_000_000));
        assertFalse("the camera said yes and wrote nothing", PhotoPlan.captured(true, 0));
        assertTrue(PhotoPlan.captured(true, 4_000_000));
    }

    /** Pixel work stands behind this; the test's version writes a file of a given size for each step. */
    private static final class FakePixels implements PhotoPlan.Pixels {
        final List<String> asked = new ArrayList<>();
        final long[] sizes;
        boolean exif;
        boolean fails;

        FakePixels(long... sizes) { this.sizes = sizes; }

        @Override public boolean encode(File raw, File out, PhotoPlan.Step step) throws Exception {
            asked.add(step.longEdge + "@" + step.quality);
            if (fails) return false;
            long size = sizes[Math.min(asked.size() - 1, sizes.length - 1)];
            try (java.io.RandomAccessFile f = new java.io.RandomAccessFile(out, "rw")) {
                f.setLength(0);
                f.write(exif ? JpegCheckTest.withExif() : JpegCheckTest.plain());
                f.setLength(Math.max(size, f.length()));
            }
            return true;
        }
    }

    private File raw() throws Exception {
        File raw = new File(tmp.newFolder(), "1700000000000-ab12cd34.meal-photo.raw.part");
        Files.write(raw.toPath(), new byte[5_000_000]);
        return raw;
    }

    @Test public void aPhotoIsAlwaysEncodedAgainAndTheCamerasFileNeverGoesOut() throws Exception {
        File raw = raw();
        File out = new File(raw.getParentFile(), "1700000000000-ab12cd34.meal-photo.jpg.part");
        FakePixels pixels = new FakePixels(900_000);
        assertEquals(PhotoPlan.Preparation.READY, PhotoPlan.prepare(raw, out, pixels));
        assertEquals("[2048@85]", pixels.asked.toString());
        assertEquals(900_000, out.length());
        assertTrue("camera output stays private until the clean result is committed", raw.exists());
        // Even a capture that is already small and under the limit is encoded again: that is what drops its EXIF.
        File small = raw();
        Files.write(small.toPath(), new byte[40_000]);
        FakePixels again = new FakePixels(30_000);
        assertEquals(PhotoPlan.Preparation.READY, PhotoPlan.prepare(small, new File(small.getParentFile(), "out.jpg.part"), again));
        assertEquals(1, again.asked.size());
    }

    @Test public void aPhotoStillOverTheLimitIsEncodedSmallerUntilItFits() throws Exception {
        File raw = raw();
        File out = new File(raw.getParentFile(), "out.jpg.part");
        FakePixels pixels = new FakePixels(PhotoPlan.MAX_BYTES + 1, PhotoPlan.MAX_BYTES + 1, 4_000_000);
        assertEquals(PhotoPlan.Preparation.READY, PhotoPlan.prepare(raw, out, pixels));
        assertEquals(3, pixels.asked.size());
        assertEquals(4_000_000, out.length());
        assertEquals("exactly at the limit goes", 1, sizeSteps(PhotoPlan.MAX_BYTES));
    }

    private int sizeSteps(long size) throws Exception {
        FakePixels pixels = new FakePixels(size);
        File raw = raw();
        assertEquals(PhotoPlan.Preparation.READY, PhotoPlan.prepare(raw, new File(raw.getParentFile(), "out.jpg.part"), pixels));
        return pixels.asked.size();
    }

    @Test public void aPhotoThatCannotBeMadeToFitOrCannotBeReadKeepsOnlyThePrivateSource() throws Exception {
        File raw = raw();
        File out = new File(raw.getParentFile(), "out.jpg.part");
        FakePixels tooBig = new FakePixels(PhotoPlan.MAX_BYTES + 1);
        assertEquals(PhotoPlan.Preparation.TOO_LARGE, PhotoPlan.prepare(raw, out, tooBig));
        assertEquals(PhotoPlan.STEPS.length, tooBig.asked.size());
        assertFalse(out.exists());
        assertTrue(raw.exists());

        File unreadable = raw();
        FakePixels broken = new FakePixels(1000);
        broken.fails = true;
        assertEquals(PhotoPlan.Preparation.UNREADABLE, PhotoPlan.prepare(unreadable, out, broken));
        assertEquals("a file that is not a picture is not tried at every size", 1, broken.asked.size());
        assertFalse(out.exists());
        assertTrue(unreadable.exists());

        File throwing = raw();
        assertEquals(PhotoPlan.Preparation.PROCESSING_FAILED,
                PhotoPlan.prepare(throwing, out, (r, o, step) -> { throw new IllegalStateException("decoder"); }));
        assertFalse(out.exists());
        assertTrue(throwing.exists());
    }

    /** A photo's position must never leave the phone: an encoded file that still holds EXIF is not queued. */
    @Test public void anEncodedPhotoThatStillHoldsExifIsRefused() throws Exception {
        File raw = raw();
        File out = new File(raw.getParentFile(), "out.jpg.part");
        FakePixels pixels = new FakePixels(50_000);
        pixels.exif = true;
        assertEquals(PhotoPlan.Preparation.PRIVACY_CHECK, PhotoPlan.prepare(raw, out, pixels));
        assertFalse(out.exists());
        assertTrue(raw.exists());
    }
    @Test public void optionalBrokenOrientationDoesNotPreventDecoding() throws Exception {
        assertEquals(6, PhotoPlan.readOrientation(() -> 6));
        assertEquals(1, PhotoPlan.readOrientation(() -> { throw new java.io.IOException("bad EXIF"); }));
        assertEquals(1, PhotoPlan.readOrientation(() -> { throw new IllegalArgumentException("bad EXIF"); }));
    }

    @Test public void preparationReportsPrivacyAndWriteFailuresAndKeepsConfirmedRawForRetry() throws Exception {
        File raw = raw();
        File out = new File(raw.getParentFile(), "out.jpg.part");
        FakePixels unsafe = new FakePixels(50_000);
        unsafe.exif = true;
        assertEquals(PhotoPlan.Preparation.PRIVACY_CHECK, PhotoPlan.prepare(raw, out, unsafe));
        assertTrue(raw.isFile());
        assertFalse(out.exists());

        assertEquals(PhotoPlan.Preparation.OUTPUT_WRITE,
                PhotoPlan.prepare(raw, out, (r, o, step) -> { throw new PhotoPlan.WriteFailure(); }));
        assertTrue(raw.isFile());
        assertFalse(out.exists());
        assertEquals(PhotoPlan.Preparation.READY, PhotoPlan.prepare(raw, out, new FakePixels(50_000)));
        assertTrue(raw.isFile());
        assertTrue(out.isFile());
    }
}
