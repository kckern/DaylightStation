package net.kckern.pianobridge;
import org.junit.Test;
import static org.junit.Assert.*;

public class AndroidPianoKioskPolicyTest {
    @Test public void revokedAuthorityBetweenAndroidSettersWithholdsSecondRelease() {
        boolean[] allowed={true};
        int[] writes={0};
        try {
            AndroidPianoKioskPolicy.releaseWithAuthority(() -> allowed[0],
                () -> { writes[0]++; allowed[0]=false; }, () -> writes[0]++);
            fail("release reported success after revocation");
        } catch (IllegalStateException expected) { }
        assertEquals(1,writes[0]);
    }
    @Test public void unavailableAuthorityWithholdsBothAndroidSetters() {
        int[] writes={0};
        try {
            AndroidPianoKioskPolicy.releaseWithAuthority(() -> false,
                () -> writes[0]++, () -> writes[0]++);
            fail("release reported success without authority");
        } catch (IllegalStateException expected) { }
        assertEquals(0,writes[0]);
    }
    @Test public void currentAuthorityRequestsBothReleaseSetters() {
        int[] writes={0};
        AndroidPianoKioskPolicy.releaseWithAuthority(() -> true,
            () -> writes[0]++, () -> writes[0]++);
        assertEquals(2,writes[0]);
    }
}
