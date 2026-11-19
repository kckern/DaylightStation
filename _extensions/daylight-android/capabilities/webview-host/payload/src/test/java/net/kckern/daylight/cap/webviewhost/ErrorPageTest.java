package net.kckern.daylight.cap.webviewhost;

import static org.junit.Assert.*;

import org.junit.Test;

public class ErrorPageTest {
    @Test public void namesTheUrlTheErrorAndTheRetry() {
        String html = ErrorPage.html("https://app.example.test/piano", "-6 net::ERR_CONNECTION_REFUSED", 30_000);
        assertTrue(html.contains("https://app.example.test/piano"));
        assertTrue(html.contains("ERR_CONNECTION_REFUSED"));
        assertTrue(html.contains("Trying again in 30 s"));
    }

    @Test public void saysSoWhenNoRetryIsScheduled() {
        assertTrue(ErrorPage.html("https://app.example.test/", "timeout", -1).contains("No retry is scheduled"));
    }

    @Test public void escapesWhatItShows() {
        String html = ErrorPage.html("https://a.test/?q=<script>alert(1)</script>&x=\"y\"", "<b>", 1000);
        assertFalse(html.contains("<script>alert"));
        assertTrue(html.contains("&lt;script&gt;"));
        assertTrue(html.contains("&quot;y&quot;"));
        assertTrue(html.contains("&lt;b&gt;"));
    }

    @Test public void aKioskWithNoStartUrlSaysItIsNotConfiguredAndNamesTheSetting() {
        String html = ErrorPage.notConfigured("piano");
        assertTrue(html.contains("This screen is not set up yet"));
        assertTrue(html.contains("webview.startUrl"));
        assertTrue(html.contains("piano"));
        assertFalse("nothing was tried, so nothing is unreachable", html.contains("cannot reach"));
    }
}
