package net.kckern.daylight.cap.mediaservice;

import static org.junit.Assert.*;

import org.junit.Test;

public class FailureReasonTest {
    @Test public void aTimeoutIsNotOffline() {
        assertEquals("timeout", FailureReason.of(new java.net.SocketTimeoutException("read timed out")));
        assertEquals("timeout", FailureReason.of(new java.io.IOException("wrapped", new java.net.SocketTimeoutException())));
    }

    @Test public void statusesSayWhatHomeSaid() {
        assertEquals("not-found", FailureReason.of(new MediaApi.Refused("list", 404)));
        assertEquals("refused", FailureReason.of(new MediaApi.Refused("list", 401)));
        assertEquals("refused", FailureReason.of(new MediaApi.Refused("list", 403)));
        assertEquals("home-error", FailureReason.of(new MediaApi.Refused("list", 502)));
        assertEquals("bad-request", FailureReason.of(new MediaApi.Refused("list", 400)));
    }

    @Test public void noRouteIsUnreachable() {
        assertEquals("unreachable", FailureReason.of(new java.net.UnknownHostException("home")));
        assertEquals("unreachable", FailureReason.of(new java.net.ConnectException("refused")));
        assertEquals("unreachable", FailureReason.of(new java.io.IOException("other")));
    }

    /**
     * Contract with the shell's SearchRetryTest (same list there): these are every reason
     * a failure can carry; the shell retries exactly the ones its words call "Home isn't answering".
     */
    @Test public void everyReasonThatCanBeSentIsOneTheShellClassifies() {
        java.util.Set<String> seen = new java.util.TreeSet<>();
        for (int status = 100; status < 600; status++) seen.add(FailureReason.ofStatus(status));
        seen.add(FailureReason.of(new java.net.SocketTimeoutException()));
        seen.add(FailureReason.of(new java.net.UnknownHostException()));
        seen.add(FailureReason.of(new java.io.IOException()));
        seen.add(FailureReason.of(new IllegalArgumentException()));
        assertEquals(new java.util.TreeSet<>(java.util.Arrays.asList("timeout", "home-error", "unreachable", "not-found", "refused", "bad-request")), seen);
    }
}
