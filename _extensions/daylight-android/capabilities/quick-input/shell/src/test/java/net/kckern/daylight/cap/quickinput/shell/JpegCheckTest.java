package net.kckern.daylight.cap.quickinput.shell;

import static org.junit.Assert.*;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;

public class JpegCheckTest {
    @Rule public TemporaryFolder tmp = new TemporaryFolder();

    private static void segment(ByteArrayOutputStream out, int marker, byte[] payload) {
        out.write(0xff);
        out.write(marker);
        int length = payload.length + 2;
        out.write(length >> 8);
        out.write(length & 0xff);
        out.write(payload, 0, payload.length);
    }

    private static byte[] jpeg(boolean exif, boolean xmp) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(0xff); out.write(0xd8);
        segment(out, 0xe0, "JFIF\0\1\1\0\0\1\0\1\0\0".getBytes(StandardCharsets.ISO_8859_1));
        if (exif) segment(out, 0xe1, "Exif\0\0MM\0*GPS 47.6 -122.3".getBytes(StandardCharsets.ISO_8859_1));
        if (xmp) segment(out, 0xe1, "http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>".getBytes(StandardCharsets.ISO_8859_1));
        segment(out, 0xdb, new byte[65]);
        segment(out, 0xc0, new byte[15]);
        segment(out, 0xda, new byte[10]);
        // Scan data. Bytes that look like an EXIF header here are picture, not metadata.
        byte[] scan = "ÿ\u0000Exif\0\0 picture data".getBytes(StandardCharsets.ISO_8859_1);
        out.write(scan, 0, scan.length);
        out.write(0xff); out.write(0xd9);
        return out.toByteArray();
    }

    static byte[] plain() { return jpeg(false, false); }
    static byte[] withExif() { return jpeg(true, false); }

    private File file(byte[] bytes) throws Exception {
        File f = tmp.newFile();
        Files.write(f.toPath(), bytes);
        return f;
    }

    @Test public void aPlainJpegIsCleanAndOneWithAnExifOrXmpSegmentIsNot() throws Exception {
        assertTrue(JpegCheck.clean(file(plain())));
        assertFalse("EXIF is where a camera writes the position", JpegCheck.clean(file(withExif())));
        assertFalse("XMP can hold it too", JpegCheck.clean(file(jpeg(false, true))));
    }

    @Test public void whatIsNotAJpegIsNotClean() throws Exception {
        assertFalse(JpegCheck.clean(file(new byte[0])));
        assertFalse(JpegCheck.clean(file(new byte[] { 1, 2, 3, 4 })));
        assertFalse(JpegCheck.clean(file("\u0089PNG\r\n".getBytes(StandardCharsets.ISO_8859_1))));
        assertFalse(JpegCheck.clean(new File(tmp.getRoot(), "absent.jpg")));
        byte[] cut = java.util.Arrays.copyOf(plain(), 12);
        assertFalse("a file that ends inside its headers", JpegCheck.clean(file(cut)));
    }
}
