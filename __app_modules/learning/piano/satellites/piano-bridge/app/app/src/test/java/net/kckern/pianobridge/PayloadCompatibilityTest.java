package net.kckern.pianobridge;
import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;
import java.nio.file.Files;
import java.util.*;
import java.lang.reflect.Proxy;
import net.kckern.pianobridge.api.Payload;
import net.kckern.pianobridge.api.ShellServices;

public class PayloadCompatibilityTest {
    @Rule public TemporaryFolder tmp=new TemporaryFolder();
    final List<String> started=new ArrayList<>();
    final Map<String,String> versions=new HashMap<>();
    PayloadStore store;
    private PayloadLoader loader(String current, String previous) throws Exception {
        store=new PayloadStore(tmp.newFolder());
        for (String name:new String[]{"old.jar","unknown.jar","managed.jar",PayloadLoader.BAKED_NAME})
            Files.write(new java.io.File(store.dir(),name).toPath(),new byte[]{1});
        if (previous!=null) store.activate(previous);
        if (current!=null) store.activate(current);
        versions.put("old.jar","p37-fkb-volume-lock"); versions.put("unknown.jar","future-unknown");
        versions.put("managed.jar","p38-managed-candidate"); versions.put(PayloadLoader.BAKED_NAME,"p38-managed-candidate");
        ShellServices shell=(ShellServices)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{ShellServices.class},(p,m,a)->null);
        return new PayloadLoader(store,shell, jar -> new Payload() {
            public String version() { return versions.get(jar); }
            public void start(ShellServices services) { started.add(jar); }
            public void stop() { }
            public void onAccessibilityConnected(Object svc) { }
            public void onAccessibilityDisconnected() { }
        }, () -> { });
    }
    @Test public void legacyCurrentAndRollbackNeverStartAndPointersArePreserved() throws Exception {
        PayloadLoader l=loader("old.jar","unknown.jar"); l.boot();
        assertEquals(Collections.singletonList(PayloadLoader.BAKED_NAME),started);
        assertEquals("old.jar",store.current()); assertEquals("unknown.jar",store.previous());
    }
    @Test public void compatibilityRequiresExactReviewedIdentity() {
        assertTrue(PayloadLoader.compatibleVersion("p38-managed-candidate"));
        assertFalse(PayloadLoader.compatibleVersion("p38-managed-candidate-evil"));
        assertFalse(PayloadLoader.compatibleVersion(null));
        assertFalse(PayloadLoader.compatibleVersion("p37-fkb-volume-lock"));
    }
    @Test public void compatibleCurrentStartsWithoutBakedFallback() throws Exception {
        PayloadLoader l=loader("managed.jar","old.jar"); l.boot();
        assertEquals(Collections.singletonList("managed.jar"),started);
    }
    @Test public void unknownCurrentFallsBackToCompatiblePreviousWithoutPointerMutation() throws Exception {
        PayloadLoader l=loader("unknown.jar","managed.jar"); l.boot();
        assertEquals(Collections.singletonList("managed.jar"),started);
        assertEquals("unknown.jar",store.current()); assertEquals("managed.jar",store.previous());
    }
    @Test public void unknownBakedCandidateFailsClosed() throws Exception {
        PayloadLoader l=loader("old.jar","unknown.jar"); versions.put(PayloadLoader.BAKED_NAME,"unknown"); l.boot();
        assertTrue(started.isEmpty()); assertNull(l.active());
    }
}
