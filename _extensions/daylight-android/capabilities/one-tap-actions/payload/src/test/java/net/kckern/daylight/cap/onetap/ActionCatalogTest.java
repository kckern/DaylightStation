package net.kckern.daylight.cap.onetap;

import static org.junit.Assert.*;

import net.kckern.daylight.cap.onetap.ActionCatalog.Action;
import net.kckern.daylight.cap.onetap.ActionCatalog.Kind;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class ActionCatalogTest {
    private static String message(String... lines) {
        try { ActionCatalog.parse(Arrays.asList(lines)); } catch (IllegalArgumentException e) { return e.getMessage(); }
        fail("expected IllegalArgumentException");
        return null;
    }

    @Test public void parsesEveryKindOfTarget() {
        ActionCatalog c = ActionCatalog.parse(Arrays.asList(
                "memo|New memo|mic|memo:new", "",
                "feed|Feed|open|open:/feed",
                "news|Morning news|play|media:plex:12345",
                "call|Call|open|bookmark:call",
                "lights|Lights off|bolt|api:/api/v1/home/scenes/all-off"));
        assertEquals(5, c.all().size());
        Action memo = c.find("memo");
        assertEquals(Kind.MEMO, memo.kind);
        assertEquals("memo", memo.linkKind());
        assertEquals("new", memo.linkArg());
        assertEquals("/feed", c.find("feed").linkQuery().get("path"));
        Action news = c.find("news");
        assertEquals("media", news.linkKind());
        assertEquals("play", news.linkArg());
        assertEquals("plex:12345", news.linkQuery().get("id"));
        assertEquals("call", c.find("call").linkArg());
        assertEquals("bookmark", c.find("call").linkKind());
        Action lights = c.find("lights");
        assertEquals(Kind.API, lights.kind);
        assertEquals("/api/v1/home/scenes/all-off", lights.value);
        assertNull("an api action is run by this capability, not by a link handler", lights.linkKind());
    }

    @Test public void namesTheSlotOfABadLine() {
        assertTrue(message("memo|New memo|mic|memo:new", "feed|Feed|open").contains("actions.2: expected id|label|icon|target"));
    }

    @Test public void rejectsTargetsItCannotRun() {
        assertTrue(message("x|X|open|shell:rm").contains("unknown target"));
        assertTrue(message("x|X|open|open:feed").contains("open: needs a page"));
        assertTrue(message("x|X|open|open://evil.example").contains("open: needs a page"));
        assertTrue("an open action is a page; an API call is an api: action", message("x|X|open|open:/api/v1/x").contains("open: needs a page"));
        assertTrue(message("x|X|open|api:/admin/x").contains("api: path must start with /api/"));
        assertTrue(message("x|X|open|api:/api/../admin").contains("api:"));
        assertTrue(message("x|X|open|api://evil.example/api/").contains("api:"));
        assertTrue(message("x|X|open|api:/api/v1/x y").contains("api:"));
        assertTrue(message("x|X|open|memo:delete").contains("memo: only 'new'"));
        assertTrue(message("x|X|open|media:12345").contains("media: needs a content id"));
        assertTrue(message("x|X|open|media:plex:1&x=2").contains("media: needs a content id"));
        assertTrue(message("x|X|open|bookmark:Not An Id").contains("bookmark: needs a bookmark id"));
        assertTrue(message("x|X|open|intent:#Intent;end").contains("unknown target"));
        assertTrue(message("x|X|open|https://evil.example/").contains("unknown target"));
    }

    @Test public void aRefusalDoesNotRepeatTheTarget() {
        // A target can be a private path; the problem is logged.
        assertFalse(message("x|X|open|shell:rm-rf").contains("rm-rf"));
    }

    @Test public void rejectsABadIdOrADuplicate() {
        assertTrue(message("Memo|New memo|mic|memo:new").contains("id must match"));
        assertTrue(message("memo|New memo|mic|memo:new", "memo|Again|mic|memo:new").contains("actions.2: id 'memo' is used twice"));
    }

    @Test public void aLabelFitsAShortcut() {
        assertTrue(message("memo||mic|memo:new").contains("label"));
        assertTrue(message("memo|A label that is far too long for a launcher shortcut|mic|memo:new").contains("label"));
    }

    @Test public void oneLineCanBeCheckedOnItsOwn() {
        assertNull(ActionCatalog.problem(""));
        assertNull(ActionCatalog.problem("memo|New memo|mic|memo:new"));
        assertTrue(ActionCatalog.problem("memo|New memo|mic").contains("expected id|label|icon|target"));
    }

    @Test public void theLenientReadKeepsTheGoodLinesAndReportsTheRest() {
        List<String> problems = new ArrayList<>();
        ActionCatalog c = ActionCatalog.usable(Arrays.asList("memo|New memo|mic|memo:new", "broken", "memo|Again|mic|memo:new",
                "feed|Feed|open|open:/feed"), problems);
        assertEquals(2, c.all().size());
        assertEquals(2, problems.size());
        assertTrue(problems.get(0).startsWith("actions.2:"));
    }
    // ── quick inputs ─────────────────────────────────────────────────────────

    @Test public void anInputActionNamesAKindAndADestination() {
        ActionCatalog c = ActionCatalog.parse(Arrays.asList("journal|Journal|mic|input:voice:journal",
                "note|Meal note|open|input:text:meal-note", "photo|Meal photo|star|input:photo:meal-photo"));
        Action journal = c.find("journal");
        assertEquals(Kind.INPUT, journal.kind);
        assertEquals("voice:journal", journal.value);
        assertEquals("input", journal.linkKind());
        assertEquals("voice", journal.linkArg());
        assertEquals("{to=journal}", journal.linkQuery().toString());
        assertEquals("text", c.find("note").linkArg());
        assertEquals("{to=meal-note}", c.find("note").linkQuery().toString());
        assertEquals("photo", c.find("photo").linkArg());
        assertEquals("{to=meal-photo}", c.find("photo").linkQuery().toString());
    }

    @Test public void anInputTargetIsHeldToItsShape() {
        for (String bad : new String[] { "input:video:journal", "input:voice:", "input:voice", "input::journal", "input:voice:Journal",
                "input:voice:journal:extra", "input:voice:/api/v1/journalist/voice", "input:voice:https://elsewhere.example", "input:" }) {
            assertTrue(bad, message("x|X|mic|" + bad).contains("input: needs voice, text or photo and a destination id"));
        }
    }

    // ── the location placeholder ─────────────────────────────────────────────

    @Test public void locationShareIsAnActionRunByThisCapability() {
        Action omw = ActionCatalog.parse(Arrays.asList("omw|On my way|bolt|location:share")).find("omw");
        assertEquals(Kind.LOCATION, omw.kind);
        assertEquals("share", omw.value);
        assertNull("no link handler performs it", omw.linkKind());
    }

    @Test public void locationTakesShareAndNothingElse() {
        for (String bad : new String[] { "location:", "location:track", "location:share:extra", "location:/api/v1/where", "location:Share" }) {
            assertTrue(bad, message("x|X|bolt|" + bad).contains("location: only 'share' is supported"));
        }
    }

    /** The earlier name keeps working: memo:new is a voice input for the journal, through the memo link. */
    @Test public void memoNewIsStillAnActionAndStillTheMemoLink() {
        Action memo = ActionCatalog.parse(Arrays.asList("memo|Journal|mic|memo:new")).find("memo");
        assertEquals(Kind.MEMO, memo.kind);
        assertEquals("memo", memo.linkKind());
        assertEquals("new", memo.linkArg());
        assertTrue(memo.linkQuery().isEmpty());
    }
}
