package net.kckern.pianobridge.api;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
public final class AdminAccess {
    private AdminAccess() { }
    public static boolean accepts(String expected, String provided) {
        return expected!=null && !expected.isEmpty() && provided!=null
                && MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), provided.getBytes(StandardCharsets.UTF_8));
    }
}
