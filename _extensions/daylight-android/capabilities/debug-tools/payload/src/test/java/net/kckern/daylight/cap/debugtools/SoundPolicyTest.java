package net.kckern.daylight.cap.debugtools;

import static org.junit.Assert.*;

import org.junit.Test;

public class SoundPolicyTest {
    private static final String START = "https://kiosk.example/piano";

    @Test public void aUrlOnTheStartPagesOriginMayPlay() {
        assertNull(SoundPolicy.refusal("https://kiosk.example/media/chime.mp3", START, "", ""));
        assertNull(SoundPolicy.refusal("https://KIOSK.example:443/a.mp3?x=1", START, "", ""));
    }

    @Test public void aBridgeOriginMayPlayAndTheStartOriginStillMay() {
        String bridge = "https://app.example, http://192.0.2.7:8080";
        assertNull(SoundPolicy.refusal("http://192.0.2.7:8080/a.mp3", START, bridge, ""));
        assertNull(SoundPolicy.refusal("https://app.example/a.mp3", START, bridge, ""));
        assertNull(SoundPolicy.refusal("https://kiosk.example/a.mp3", START, bridge, ""));
    }

    @Test public void anotherOriginIsRefusedUnlessTheSettingNamesIt() {
        String refusal = SoundPolicy.refusal("https://elsewhere.example/a.mp3", START, "", "");
        assertNotNull(refusal);
        assertTrue(refusal, refusal.contains("debug.soundOrigins"));
        assertNotNull("the same host on another port is another origin", SoundPolicy.refusal("https://kiosk.example:8443/a.mp3", START, "", ""));
        assertNotNull("and so is another scheme", SoundPolicy.refusal("http://kiosk.example/a.mp3", START, "", ""));
        assertNull(SoundPolicy.refusal("https://elsewhere.example/a.mp3", START, "", "https://elsewhere.example"));
        assertNull(SoundPolicy.refusal("https://anywhere.example/a.mp3", START, "", " * "));
    }

    @Test public void onlyHttpAndHttpsAreEverPlayedWhateverTheSettingSays() {
        for (String url : new String[] { "file:///sdcard/x.mp3", "content://media/external/audio/1", "/sdcard/x.mp3", "x.mp3", "",
                "javascript:alert(1)", "data:audio/mp3;base64,AAAA", "ftp://kiosk.example/a.mp3", "https://user@kiosk.example/a.mp3",
                "rtsp://kiosk.example/a", "android.resource://com.example.game/raw/a" }) {
            String refusal = SoundPolicy.refusal(url, START, "", "*");
            assertNotNull(url, refusal);
            assertTrue(refusal, refusal.contains("http"));
        }
        assertNotNull(SoundPolicy.refusal(null, START, "", "*"));
    }

    @Test public void withNoStartUrlAndNoSettingNothingIsTrusted() {
        assertNotNull(SoundPolicy.refusal("https://kiosk.example/a.mp3", "", "", ""));
        assertNotNull(SoundPolicy.refusal("https://kiosk.example/a.mp3", null, null, null));
    }
}
