package net.kckern.daylight.cap.quickinput.shell;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.DataInputStream;
import java.io.IOException;
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

    /** Remove metadata added by the device's encoder before the first JPEG scan. */
    static void stripPrivateHeaders(File source, File destination) throws IOException {
        try (DataInputStream input = new DataInputStream(new BufferedInputStream(new FileInputStream(source)));
             FileOutputStream file = new FileOutputStream(destination);
             BufferedOutputStream output = new BufferedOutputStream(file)) {
            if (input.readUnsignedByte() != 0xff || input.readUnsignedByte() != SOI)
                throw new IOException("Invalid JPEG start");
            output.write(0xff);
            output.write(SOI);
            while (true) {
                if (input.readUnsignedByte() != 0xff) throw new IOException("Invalid JPEG marker");
                int marker = input.readUnsignedByte();
                while (marker == 0xff) marker = input.readUnsignedByte();
                if (marker == 0 || marker == SOI || marker == 0xd9 || marker == 1
                        || marker >= 0xd0 && marker <= 0xd7)
                    throw new IOException("Unexpected JPEG marker");
                int length = input.readUnsignedShort();
                if (length < 2) throw new IOException("Invalid JPEG segment length");
                byte[] segment = new byte[length - 2];
                input.readFully(segment);
                if (marker != APP1 && marker != APP13 && marker != 0xfe
                        && (marker != 0xe2 || isIccProfile(segment))) {
                    output.write(0xff);
                    output.write(marker);
                    output.write(length >>> 8);
                    output.write(length & 0xff);
                    output.write(segment);
                }
                if (marker == SOS) {
                    copyBaselineScan(input, output);
                    output.flush();
                    file.getFD().sync();
                    return;
                }
            }
        }
    }

    private static boolean isIccProfile(byte[] segment) {
        byte[] signature = "ICC_PROFILE\0".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
        if (segment.length < signature.length + 2) return false;
        for (int i = 0; i < signature.length; i++) {
            if (segment[i] != signature[i]) return false;
        }
        return true;
    }

    /** Android emits baseline JPEG. Drop data appended after its primary image. */
    private static void copyBaselineScan(DataInputStream input, BufferedOutputStream output) throws IOException {
        while (true) {
            int value = input.readUnsignedByte();
            output.write(value);
            if (value != 0xff) continue;
            int marker = input.readUnsignedByte();
            while (marker == 0xff) marker = input.readUnsignedByte();
            if (marker != 0 && marker != 0xd9 && (marker < 0xd0 || marker > 0xd7))
                throw new IOException("Unexpected marker in Android JPEG scan");
            output.write(marker);
            if (marker == 0xd9) return;
        }
    }

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
