package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.quickinput.Destinations.Destination;
import net.kckern.daylight.cap.quickinput.Destinations.Kind;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class DestinationsTest {
    private static Destinations of(List<String> problems, String... lines) {
        return Destinations.usable(Arrays.asList(lines), problems);
    }

    @Test public void theDefaultsAreTheContractsTable() {
        List<String> problems = new ArrayList<>();
        Destinations d = Destinations.usable(Arrays.asList(Destinations.DEFAULTS), problems);
        assertTrue(problems.toString(), problems.isEmpty());
        String[][] table = {
                { "journal", "voice", "/api/v1/journalist/voice", "Journal" },
                { "journal-note", "text", "/api/v1/journalist/text", "Journal note" },
                { "meal", "voice", "/api/v1/nutribot/voice", "Meal" },
                { "meal-note", "text", "/api/v1/nutribot/text", "Meal note" },
                { "meal-photo", "photo", "/api/v1/nutribot/photo", "Meal photo" },
        };
        assertEquals(table.length, d.all().size());
        for (String[] row : table) {
            Destination dest = d.find(row[0]);
            assertNotNull(row[0], dest);
            assertEquals(row[0], row[1], dest.kind.word);
            assertEquals(row[0], row[2], dest.route);
            assertEquals(row[0], row[3], dest.label);
        }
        assertTrue("every default fits a slot", Destinations.DEFAULTS.length <= Destinations.SLOTS);
    }

    @Test public void aLineIsIdLabelKindRoute() {
        List<String> problems = new ArrayList<>();
        Destinations d = of(problems, " walk | Walk log | text | /api/v1/example/text ");
        assertTrue(problems.isEmpty());
        Destination walk = d.find("walk");
        assertEquals("Walk log", walk.label);
        assertEquals(Kind.TEXT, walk.kind);
        assertEquals("/api/v1/example/text", walk.route);
        assertNull(d.find("journal"));
    }

    @Test public void anEmptyLineIsAnUnusedSlot() {
        List<String> problems = new ArrayList<>();
        Destinations d = of(problems, "", "   ", null, "meal|Meal|voice|/api/v1/nutribot/voice");
        assertTrue(problems.isEmpty());
        assertEquals(1, d.all().size());
        assertNull(Destinations.problem(""));
        assertNull(Destinations.problem(null));
    }

    @Test public void aRouteIsAPlainPathUnderApiV1AndNothingElse() {
        assertNull(Destinations.problem("a|A|voice|/api/v1/journalist/voice"));
        assertNull(Destinations.problem("a|A|voice|/api/v1/a/b/c.d_e~f-g"));
        String[] refused = {
                "https://kiosk.example/api/v1/journalist/voice",   // an address: a destination is never another host
                "//kiosk.example/api/v1/journalist/voice",
                "/api/v2/journalist/voice",
                "/api/v1",
                "/api/v1/",
                "/api/v1/journalist/voice/",
                "/api/v1/journalist/voice?user=someone",           // the user is added when it is sent
                "/api/v1/journalist/voice#x",
                "/api/v1/../v2/thing",
                "/api/v1/./thing",
                "/api/v1/a//b",
                "/api/v1/a%2f..%2fb",
                "/api/v1/a b",
                "/api/v1/a\\b",
                "/API/v1/journalist/voice",
                "api/v1/journalist/voice",
                "/feed",
                "",
        };
        for (String route : refused) {
            String problem = Destinations.problem("a|A|voice|" + route);
            assertNotNull("accepted " + route, problem);
            // "/api/v1" and "/api/v1/" are in the rule's own wording; anything longer is the setter's.
            assertTrue("the route is private and is not repeated: " + problem, route.length() <= 8 || !problem.contains(route));
        }
        StringBuilder longRoute = new StringBuilder("/api/v1");
        while (longRoute.length() <= Destinations.MAX_ROUTE) longRoute.append("/segment");
        assertNotNull(Destinations.problem("a|A|voice|" + longRoute));
    }

    @Test public void anIdALabelAndAKindAreHeldToTheirShapes() {
        assertNotNull(Destinations.problem("Journal|A|voice|/api/v1/x"));
        assertNotNull(Destinations.problem("1a|A|voice|/api/v1/x"));
        assertNotNull(Destinations.problem("a.b|A|voice|/api/v1/x"));
        assertNotNull(Destinations.problem("abcdefghijklmnopqrstuvwxyzabcdefg|A|voice|/api/v1/x"));
        assertNotNull(Destinations.problem("a||voice|/api/v1/x"));
        assertNotNull(Destinations.problem("a|abcdefghijklmnopqrstuvwxyz|voice|/api/v1/x"));
        assertNotNull(Destinations.problem("a|A\u0007B|voice|/api/v1/x"));
        assertNotNull(Destinations.problem("a|A|video|/api/v1/x"));
        assertNotNull(Destinations.problem("a|A|voice,text|/api/v1/x"));
        assertNotNull(Destinations.problem("a|A|Voice|/api/v1/x"));
        assertNotNull(Destinations.problem("a|A|voice"));
        assertNotNull(Destinations.problem("a|A|voice|/api/v1/x|extra"));
        assertNull(Destinations.problem("a|abcdefghijklmnopqrstuvwxy|photo|/api/v1/x"));
    }

    @Test public void aLineWithAProblemIsLeftOutAndReportedWithItsSlot() {
        List<String> problems = new ArrayList<>();
        Destinations d = of(problems, "journal|Journal|voice|/api/v1/journalist/voice", "bad|Bad|voice|/elsewhere",
                "journal|Again|text|/api/v1/journalist/text");
        assertEquals(1, d.all().size());
        assertEquals("Journal", d.find("journal").label);
        assertEquals(2, problems.size());
        assertTrue(problems.get(0), problems.get(0).startsWith("input.dest.2: "));
        assertEquals("input.dest.3: id 'journal' is used twice", problems.get(1));
    }

    @Test public void aKindKnowsItsWordItsLimitAndWhatItIsSentAs() {
        assertEquals(Kind.VOICE, Kind.of("voice"));
        assertEquals(Kind.TEXT, Kind.of("text"));
        assertEquals(Kind.PHOTO, Kind.of("photo"));
        assertNull(Kind.of("video"));
        assertNull(Kind.of(null));
        assertEquals(26_214_400L, Kind.VOICE.maxBytes);
        assertEquals(16_384L, Kind.TEXT.maxBytes);
        assertEquals(15_728_640L, Kind.PHOTO.maxBytes);
        assertEquals("audio/ogg", Kind.VOICE.contentType("1700000000000-ab12cd34.journal.ogg"));
        assertEquals("audio/mp4", Kind.VOICE.contentType("1700000000000-ab12cd34-00@1700000000000.m4a"));
        assertEquals("text/plain; charset=utf-8", Kind.TEXT.contentType("x.txt"));
        assertEquals("image/jpeg", Kind.PHOTO.contentType("x.jpg"));
    }

    @Test public void shareTargetsAreTheShareTextDestinationsInSlotOrder() {
        Destinations d = of(null,
                "journal|Journal|voice|/api/v1/journalist/voice",
                "share-office|Office|text|/api/v1/share/to/office/text",
                "sharer|Not a share|text|/api/v1/journalist/text",
                "share-voice|Spoken|voice|/api/v1/journalist/voice",
                "share|Default|text|/api/v1/share/text");
        List<Destination> targets = d.shareTargets();
        assertEquals(2, targets.size());
        assertEquals("share-office", targets.get(0).id);
        assertEquals("share", targets.get(1).id);
    }

    @Test public void theDefaultsHaveNoShareTarget() {
        assertTrue(Destinations.usable(Arrays.asList(Destinations.DEFAULTS), null).shareTargets().isEmpty());
    }
}
