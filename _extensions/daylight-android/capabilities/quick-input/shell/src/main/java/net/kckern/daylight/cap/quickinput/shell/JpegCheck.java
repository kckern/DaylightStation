package net.kckern.daylight.cap.quickinput.shell;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;

/**
 * Whether a JPEG file holds no metadata that could say where it was taken. Pure.
 *
 * A camera writes the position, the time and the phone's model into an EXIF segment
 * (APP1); XMP (APP1 too) and IPTC (APP13) can hold a place as well. The photo screen
 * writes every capture again from its pixels, which leaves none of them. This reads the
 * written file's headers, up to where the picture data starts, to make sure of it.
 */
final class JpegCheck {
    private static final int SOI = 0xd8;
    private static final int SOS = 0xda;
    private static final int APP1 = 0xe1;
    private static final int APP13 = 0xed;

    private JpegCheck() { }

    /** True when the file is a JPEG whose headers hold no EXIF, XMP or IPTC segment. Anything unreadable is not clean. */
    static boolean clean(File file) {
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            if (in.read() != 0xff || in.read() != SOI) return false;
            while (true) {
                int b = in.read();
                if (b != 0xff) return false;
                int marker = in.read();
                while (marker == 0xff) marker = in.read();           // fill bytes
                if (marker < 0) return false;
                if (marker == SOS) return true;                      // the picture data starts: the headers are over
                if (marker == APP1 || marker == APP13) return false;
                int high = in.read(), low = in.read();
                if (high < 0 || low < 0) return false;
                long skip = ((high << 8) | low) - 2;
                if (skip < 0) return false;
                while (skip > 0) {
                    long n = in.skip(skip);
                    if (n <= 0) {
                        if (in.read() < 0) return false;             // the file ends inside its headers
                        n = 1;
                    }
                    skip -= n;
                }
            }
        } catch (Exception unreadable) {
            return false;
        }
    }
}
