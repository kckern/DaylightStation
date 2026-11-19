package net.kckern.daylight.api;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * A stream copy that gives up at a size limit. The shell uses it for a pushed
 * payload and the core for a self-update APK, so one download cannot fill the disk.
 */
public final class CappedCopy {
    private CappedCopy() { }

    /** Refuse a download whose declared length is over the limit. A length of -1 means none was declared. */
    public static void checkDeclaredLength(long declared, long limit, String what) throws IOException {
        if (declared > limit) throw new IOException(what + " is larger than " + limit + " bytes");
    }

    /** Copy until the stream ends, giving up once more than the limit has arrived. Returns the byte count. */
    public static long copy(InputStream in, OutputStream out, long limit, String what) throws IOException {
        byte[] buf = new byte[65536];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > limit) throw new IOException(what + " is larger than " + limit + " bytes");
            out.write(buf, 0, n);
        }
        return total;
    }
}
