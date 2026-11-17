package net.kckern.daylight.cap.quickinput;

import static org.junit.Assert.*;

import org.junit.Test;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public class QueueNoticeTest {
    private static final Map<String, Integer> NONE = Collections.emptyMap();
    private static final Map<String, Long> NO_LIMIT = Collections.emptyMap();

    /** "Journal", 2, "Meal photo", 1 */
    private static Map<String, Integer> counts(Object... labelAndCount) {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (int i = 0; i < labelAndCount.length; i += 2) out.put((String) labelAndCount[i], (Integer) labelAndCount[i + 1]);
        return out;
    }

    private static QueueNotice of(Map<String, Integer> waiting, Map<String, Integer> parked, String blocked) {
        return QueueNotice.of(waiting, parked, blocked, Collections.<String>emptyList(), NO_LIMIT);
    }

    @Test public void withNothingLeftThereIsNoNotice() {
        assertNull(of(NONE, NONE, ""));
        assertNull("with nothing kept there is nothing to say about the identity either", of(NONE, NONE, "identity not configured"));
        assertNull(of(counts("Journal", 0), NONE, ""));
    }

    @Test public void waitingInputsAreCountedAndNamedForWhereTheyGo() {
        QueueNotice one = of(counts("Journal", 1), NONE, "");
        assertEquals("Quick inputs", one.title);
        assertEquals("1 input waiting to upload (Journal 1)", one.text);
        assertEquals("daylight://input/queue", one.link);
        assertEquals("3 inputs waiting to upload (Journal 3)", of(counts("Journal", 3), NONE, "").text);
        assertEquals("3 inputs waiting to upload (Journal 2, Meal photo 1)", of(counts("Journal", 2, "Meal photo", 1), NONE, "").text);
    }

    @Test public void parkedInputsSayWhatATapDoes() {
        assertEquals("1 input could not be sent (Meal 1). Tap to try again.", of(NONE, counts("Meal", 1), "").text);
        assertEquals("2 inputs could not be sent (Meal 2). Tap to try again.", of(NONE, counts("Meal", 2), "").text);
        assertEquals("2 inputs could not be sent (Journal 1, Meal 1), 1 waiting. Tap to try again.",
                of(counts("Journal", 1), counts("Journal", 1, "Meal", 1), "").text);
    }

    @Test public void aMissingIdentityIsSaidInThoseWordsAndComesFirst() {
        QueueNotice n = of(counts("Journal", 2), counts("Meal", 1), "identity not configured");
        assertEquals("Quick inputs are not set up", n.title);
        assertEquals("identity not configured. 3 inputs are kept on this phone (Journal 2, Meal 1).", n.text);
        assertEquals("device identity not configured. 1 input is kept on this phone (Journal 1).",
                of(counts("Journal", 1), NONE, "device identity not configured").text);
    }

    @Test public void theSameStateIsTheSameNotice() {
        assertEquals(of(counts("Journal", 2), counts("Meal", 1), "").key(), of(counts("Journal", 2), counts("Meal", 1), "").key());
        assertNotEquals(of(counts("Journal", 2), counts("Meal", 1), "").key(), of(counts("Journal", 3), counts("Meal", 1), "").key());
        assertNotEquals("the same count for another destination is another notice",
                of(counts("Journal", 1), NONE, "").key(), of(counts("Meal", 1), NONE, "").key());
    }

    @Test public void parkedInputsCanBeDiscardedFromTheNotice() {
        QueueNotice n = of(NONE, counts("Meal photo", 2), "");
        assertEquals("Discard", n.actionLabel);
        assertEquals("daylight://input/discard", n.actionLink);
        assertEquals("a waiting input has no such button", "", of(counts("Journal", 2), NONE, "").actionLabel);
    }

    @Test public void aPhoneNotYetAllowedIsSaidForTheDestinationThatRefusedIt() {
        QueueNotice n = QueueNotice.of(counts("Meal", 1), NONE, "", Collections.singletonList("Meal"), NO_LIMIT);
        assertEquals("This phone is not allowed to send to Meal yet. 1 input is kept and will be sent once it is.", n.text);
        assertEquals("", n.actionLabel);
        QueueNotice two = QueueNotice.of(counts("Meal", 1, "Journal", 2), NONE, "", java.util.Arrays.asList("Meal", "Journal"), NO_LIMIT);
        assertEquals("This phone is not allowed to send to Meal or Journal yet. 3 inputs are kept and will be sent once it is.", two.text);
    }

    @Test public void theDailyAllowanceSaysForWhichDestinationAndWhenSendingResumes() {
        long at = 1_700_000_000_000L;
        QueueNotice n = QueueNotice.of(counts("Journal", 3), NONE, "", Collections.<String>emptyList(), Collections.singletonMap("Journal", at));
        assertEquals("The daily allowance for Journal is used up. Sending resumes at about " + QueueNotice.clock(at) + ". 3 inputs waiting.", n.text);
        assertTrue(QueueNotice.clock(at), QueueNotice.clock(at).matches("[A-Z][a-z]{2} \\d\\d:\\d\\d"));
        assertNotEquals("a new time is a new notice", n.key(), QueueNotice.of(counts("Journal", 3), NONE, "",
                Collections.<String>emptyList(), Collections.singletonMap("Journal", at + 3_600_000L)).key());
        Map<String, Long> both = new LinkedHashMap<>();
        both.put("Journal", at);
        both.put("Meal", at + 3_600_000L);
        assertEquals("The daily allowance for Journal is used up. Sending resumes at about " + QueueNotice.clock(at)
                        + ". The daily allowance for Meal is used up. Sending resumes at about " + QueueNotice.clock(at + 3_600_000L) + ". 2 inputs waiting.",
                QueueNotice.of(counts("Journal", 1, "Meal", 1), NONE, "", Collections.<String>emptyList(), both).text);
    }

    /** A notice is a count, a state and a destination's label. Nothing of what was said, typed or photographed. */
    @Test public void aNoticeNeverCarriesMoreThanCountsStatesAndLabels() {
        QueueNotice n = of(counts("Journal note", 1), counts("Meal photo", 1), "");
        assertEquals("1 input could not be sent (Meal photo 1), 1 waiting. Tap to try again.", n.text);
        assertEquals("Quick inputs", n.title);
    }
}
