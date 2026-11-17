package net.kckern.portalkeys.payload;
import org.junit.Test;
import org.json.JSONObject;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;
public class RecoveryGuardTest {
 private JSONObject safe() throws Exception { return new JSONObject("{\"known\":true,\"expectedAwake\":true,\"stopped\":false,\"maintenance\":false,\"revision\":7}"); }
 private void bothPaths(java.util.function.Supplier<JSONObject> safety,boolean preservation,AtomicInteger preferred,AtomicInteger foreground,AtomicInteger recreate) {
  RecoveryGuard guard=new RecoveryGuard(safety,preservation);
  HomeWatchdog.repairHome(guard,true,preferred::incrementAndGet,foreground::incrementAndGet);
  KioskPolicy.repairTask(false,false,guard,recreate::incrementAndGet);
 }
 @Test public void actualHomeAndTaskPathsSuppressStopSleepMaintenanceAndUnknown() throws Exception {
  for (JSONObject value:new JSONObject[]{new JSONObject(),safe().put("stopped",true),safe().put("expectedAwake",false),safe().put("maintenance",true),safe().put("known",false)}) {
   AtomicInteger preferred=new AtomicInteger(),foreground=new AtomicInteger(),recreate=new AtomicInteger();
   bothPaths(()->value,true,preferred,foreground,recreate);
   assertEquals(0,preferred.get());assertEquals(0,foreground.get());assertEquals(0,recreate.get());
  }
 }
 @Test public void oldShellLinkageAndMissingSnapshotFailClosed() {
  for(java.util.function.Supplier<JSONObject> source:java.util.Arrays.<java.util.function.Supplier<JSONObject>>asList(()->{throw new NoSuchMethodError("old shell");},()->null)) {
   AtomicInteger p=new AtomicInteger(),f=new AtomicInteger(),r=new AtomicInteger();bothPaths(source,true,p,f,r);
   assertEquals(0,p.get()+f.get()+r.get());
  }
 }
 @Test public void revisionChangesBetweenSideEffectsCancelRemainingActions() throws Exception {
  AtomicReference<JSONObject> source=new AtomicReference<>(safe());
  JSONObject stop=safe().put("stopped",true).put("revision",8);
  RecoveryGuard guard=new RecoveryGuard(source::get,true);
  AtomicInteger foreground=new AtomicInteger(),recreate=new AtomicInteger();
  HomeWatchdog.repairHome(guard,true,()->source.set(stop),foreground::incrementAndGet);
  KioskPolicy.repairTask(false,false,guard,recreate::incrementAndGet);
  assertEquals(0,foreground.get());assertEquals(0,recreate.get());
  source.set(safe().put("revision",9)); assertFalse(guard.run(false,foreground::incrementAndGet));
 }
 @Test public void preservationGateBlocksBothActivityPathsButNotSafePreferenceRepair() throws Exception {
  JSONObject value=safe();AtomicInteger p=new AtomicInteger(),f=new AtomicInteger(),r=new AtomicInteger();
  bothPaths(()->value,false,p,f,r);assertEquals(1,p.get());assertEquals(0,f.get());assertEquals(0,r.get());
  bothPaths(()->value,true,p,f,r);assertEquals(2,p.get());assertEquals(1,f.get());assertEquals(1,r.get());
 }
}
