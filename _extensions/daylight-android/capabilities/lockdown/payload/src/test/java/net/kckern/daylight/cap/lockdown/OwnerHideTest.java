package net.kckern.daylight.cap.lockdown;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;

public class OwnerHideTest {
    private static final String OWN = "net.kckern.daylight.test";

    @Test public void listsThePackagesToHide() {
        assertEquals(Arrays.asList("com.example.browser", "com.example.panel"),
                OwnerHide.packages(" com.example.browser , com.example.panel,", OWN, null));
        assertEquals(Collections.emptyList(), OwnerHide.packages("", OWN, null));
        assertEquals(Collections.emptyList(), OwnerHide.packages(null, OWN, null));
    }

    @Test public void neverHidesThisAppOrThePackageThatProvidesTheWebView() {
        // Hiding the WebView provider would leave the kiosk with nothing to draw its page.
        assertEquals(Collections.singletonList("com.example.panel"),
                OwnerHide.packages("com.example.browser,com.example.panel," + OWN, OWN, "com.example.browser"));
    }

    @Test public void dropsWhatIsNotAPackageName() {
        assertEquals(Collections.singletonList("com.example.panel"),
                OwnerHide.packages("*,com.example.*,notapackage,com.example.panel,com.a.b/.C", OWN, null));
    }
}
