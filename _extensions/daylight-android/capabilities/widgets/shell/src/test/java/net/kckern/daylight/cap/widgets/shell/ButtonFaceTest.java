package net.kckern.daylight.cap.widgets.shell;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class ButtonFaceTest {
    @Test public void aSquareCoverLeavesRoomForTheOverlappingBadge() {
        assertEquals(50, ButtonFace.coverSide(52, 92));
        assertEquals(23, ButtonFace.coverSide(108, 41));
        assertEquals(50, ButtonFace.coverSide(0, 0));
    }

    @Test public void aButtonWhoseActionIsInTheCacheShowsItsLabelAndIconAndLaunchesItsLink() {
        ButtonFace face = ButtonFace.of("journal", "Journal", "mic", "daylight://action/journal#k=a");
        assertTrue(face.set);
        assertEquals("Journal", face.label);
        assertEquals("ic_action_mic", face.iconName);
        assertEquals("daylight://action/journal#k=a", face.link);
    }

    @Test public void aButtonWhoseActionIsGoneIsNotSetAndHasNothingToLaunch() {
        // The payload clears the fields of an action that no longer exists; SurfaceCache.link
        // answers "" for anything that is not the app's own link.
        for (ButtonFace face : new ButtonFace[] {
                ButtonFace.of("journal", "", "", ""),
                ButtonFace.of("journal", "Stale label", "mic", ""),
                ButtonFace.of("", "Journal", "mic", "daylight://action/journal"),
                ButtonFace.of(null, null, null, null) }) {
            assertFalse(face.set);
            assertEquals("Not set", face.label);
            assertEquals(ButtonFace.UNSET_ICON, face.iconName);
            assertEquals("", face.link);
        }
    }

    @Test public void aStoredChoiceThatIsNotAnActionIdIsNotSet() {
        for (String bad : new String[] { "../x", "Journal", "a.b", "journal label" }) {
            assertFalse(bad, ButtonFace.of(bad, "L", "mic", "daylight://action/x").set);
        }
    }

    @Test public void anIconNameThatIsNotPlainFallsBackAndALabelIsNeverEmpty() {
        ButtonFace odd = ButtonFace.of("journal", "", "../drawable/x", "daylight://action/journal");
        assertTrue(odd.set);
        assertEquals("ic_action_open", odd.iconName);
        assertEquals("Daylight", odd.label);
        assertEquals("ic_action_open", ButtonFace.of("journal", "J", "", "daylight://action/journal").iconName);
    }

    @Test public void theChooserListsTheCachedActionsInOrderAndLeavesOutWhatCannotBeLaunched() {
        Map<String, String> cache = new HashMap<>();
        cache.put("action.journal.label", "Journal");
        cache.put("action.journal.uri", "daylight://action/journal#k=a");
        cache.put("action.media-1.label", "Morning");
        cache.put("action.media-1.uri", "daylight://action/media-1#k=a");
        cache.put("action.gone.label", "Gone");
        cache.put("action.gone.uri", "");
        cache.put("action.web.label", "Web");
        cache.put("action.web.uri", "https://kiosk.example/");
        List<ButtonFace.Choice> choices = ButtonFace.choices("media-1, journal,gone,web,,../x,journal", key -> cache.get(key));
        assertEquals(2, choices.size());
        assertEquals("media-1", choices.get(0).id);
        assertEquals("Morning", choices.get(0).label);
        assertEquals("journal", choices.get(1).id);
    }

    @Test public void theChooserIsEmptyBeforeAPayloadHasEverRunAndBounded() {
        assertTrue(ButtonFace.choices("", key -> null).isEmpty());
        assertTrue(ButtonFace.choices(null, key -> null).isEmpty());
        StringBuilder many = new StringBuilder();
        for (int i = 0; i < 200; i++) many.append("a").append(i).append(',');
        assertEquals(ButtonFace.MAX_CHOICES, ButtonFace.choices(many.toString(), key -> key.endsWith(".uri") ? "daylight://action/x" : "L").size());
    }

    @Test public void aWidgetIdBelongsToThisProviderOnlyWhenAndroidSaysItsProviderIsOurs() {
        String ours = "net.kckern.daylight.cap.widgets.shell.ButtonWidgetProvider";
        assertTrue(ButtonFace.ours(7, "net.kckern.daylight.phone", ours, "net.kckern.daylight.phone", ours));
        assertFalse("the invalid id", ButtonFace.ours(0, "net.kckern.daylight.phone", ours, "net.kckern.daylight.phone", ours));
        assertFalse("an id Android does not know", ButtonFace.ours(7, null, null, "net.kckern.daylight.phone", ours));
        assertFalse("the four-button widget's id", ButtonFace.ours(7, "net.kckern.daylight.phone",
                "net.kckern.daylight.cap.widgets.shell.ActionWidgetProvider", "net.kckern.daylight.phone", ours));
        assertFalse("another app's widget", ButtonFace.ours(7, "com.example.other", ours, "net.kckern.daylight.phone", ours));
        assertEquals(Arrays.asList("button.7.action"), Arrays.asList(ButtonFace.storeKey(7)));
    }
}
