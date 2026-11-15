package net.kckern.portalkeys.payload;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import static org.junit.Assert.*;

public class FkbAlertStateTest {
    @Test public void failedBreachRetriesAndKeepsRecoveryBehindIt() {
        FkbAlertState alerts = new FkbAlertState(true);
        List<String> delivered = new ArrayList<>();
        alerts.observe(false);
        alerts.deliver(event -> { throw new IllegalStateException("storage-failed"); });
        assertFalse(alerts.ready());
        assertEquals("IllegalStateException", alerts.error());
        alerts.observe(true);
        alerts.deliver(delivered::add);
        assertEquals(Arrays.asList("fkb-lost", "fkb-restored"), delivered);
        assertTrue(alerts.ready());
        assertNull(alerts.error());
        alerts.observe(true);
        alerts.deliver(delivered::add);
        assertEquals(2, delivered.size());
    }

    @Test public void unchangedStateStillRetriesFailedAlert() {
        FkbAlertState alerts = new FkbAlertState(true);
        List<String> delivered = new ArrayList<>();
        alerts.observe(false);
        alerts.deliver(event -> { throw new IllegalStateException("outbox-full"); });
        alerts.observe(false);
        assertFalse(alerts.ready());
        alerts.deliver(delivered::add);
        assertEquals(Arrays.asList("fkb-lost"), delivered);
        assertTrue(alerts.ready());
    }
}
