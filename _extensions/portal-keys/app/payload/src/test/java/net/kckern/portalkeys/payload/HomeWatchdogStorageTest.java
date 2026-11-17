package net.kckern.portalkeys.payload;
import android.content.SharedPreferences;
import java.lang.reflect.Proxy;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import static org.junit.Assert.*;
import static net.kckern.portalkeys.payload.PageWatchState.Action.*;
import static net.kckern.portalkeys.payload.PageWatchState.State.*;
public class HomeWatchdogStorageTest {
 /** Android commits to memory before disk; a failed commit must not count as durable. */
 static final class Disk {
  final Map<String,Object> values=new HashMap<>();boolean succeeds=true;
  SharedPreferences open() {
   Map<String,Object> memory=new HashMap<>(values);
   return (SharedPreferences)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.class},(proxy,method,args)-> {
    if(method.getName().startsWith("get") && args!=null && args.length==2)return memory.getOrDefault(args[0],args[1]);
    if(method.getName().equals("edit")) {
     Map<String,Object> changes=new HashMap<>();
     return Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.Editor.class},(editor,operation,data)-> {
      if(operation.getName().startsWith("put")){changes.put((String)data[0],data[1]);return editor;}
      if(operation.getName().equals("commit")){memory.putAll(changes);if(succeeds)values.putAll(changes);return succeeds;}
      throw new UnsupportedOperationException(operation.getName());
     });
    }
    throw new UnsupportedOperationException(method.getName());
   });
  }
 }
 private PageWatchState exhausted() {
  PageWatchState page=new PageWatchState();page.evaluate(15000,0,true,false,false);page.evaluate(30000,0,true,false,false);
  page.evaluate(45000,0,true,false,false);page.evaluate(60000,0,true,false,false);return page;
 }
 @Test public void committedBudgetSurvivesReopenAndBootChangeIncludingUnknownBoot() {
  Disk disk=new Disk();HomeWatchdogStorage storage=new HomeWatchdogStorage(disk.open());
  storage.commitBudgetThen(exhausted(),5,()->{});
  PageWatchState reopened=new PageWatchState();new HomeWatchdogStorage(disk.open()).restoreBudget(reopened,70000,5);
  reopened.evaluate(75000,0,true,false,false);assertEquals(FAILED,reopened.evaluate(90000,0,true,false,false).state);
  for(int boot:new int[]{6,-1}) {
   HomeWatchdogStorage rebootStorage=new HomeWatchdogStorage(disk.open());PageWatchState reboot=new PageWatchState();
   rebootStorage.restoreBudget(reboot,100,boot);assertEquals(600100,reboot.blockedUntil);
   rebootStorage.commitBudgetThen(reboot,boot,()->{});
   PageWatchState restarted=new PageWatchState();new HomeWatchdogStorage(disk.open()).restoreBudget(restarted,200,boot);
   assertTrue(restarted.blockedUntil>=600100);restarted.evaluate(15000,0,true,false,false);
   assertEquals(FAILED,restarted.evaluate(30000,0,true,false,false).state);
  }
 }
 @Test public void failedBudgetCommitCannotDispatchAndCanBeRetried() {
  Disk disk=new Disk();HomeWatchdogStorage storage=new HomeWatchdogStorage(disk.open());AtomicInteger actions=new AtomicInteger();
  disk.succeeds=false;
  try{storage.commitBudgetThen(exhausted(),5,actions::incrementAndGet);fail("dispatched after failed disk commit");}catch(IllegalStateException expected){}
  assertEquals(0,actions.get());assertFalse(disk.values.containsKey("pageRestarts"));
  disk.succeeds=true;storage.commitBudgetThen(exhausted(),5,actions::incrementAndGet);assertEquals(1,actions.get());
  PageWatchState reopened=new PageWatchState();new HomeWatchdogStorage(disk.open()).restoreBudget(reopened,70000,5);assertEquals(2,reopened.restarts.size());
 }
 @Test public void failedAlertCommitRetriesAtomicallyWithoutPublishingOrDuplicating() throws Exception {
  Disk disk=new Disk();HomeWatchdogStorage storage=new HomeWatchdogStorage(disk.open());HomeWatchState state=new HomeWatchState();
  disk.succeeds=false;
  try{storage.enqueue("page-failed",null,state,"incident-1");fail("acknowledged failed alert commit");}catch(IllegalStateException expected){}
  assertFalse(disk.values.containsKey("outbox"));assertFalse(disk.values.containsKey("pageFailureIncident"));
  try{storage.outbox();fail("exposed undurable alert to delivery");}catch(IllegalStateException expected){}
  try{storage.retryAlert();fail("acknowledged failed retry");}catch(IllegalStateException expected){}
  disk.succeeds=true;storage.retryAlert();
  HomeWatchdogStorage reopened=new HomeWatchdogStorage(disk.open());
  assertFalse(reopened.enqueue("page-failed",null,state,"incident-1"));assertEquals(1,reopened.outbox().length());
  assertEquals("incident-1",disk.values.get("pageFailureIncident"));assertEquals(1L,disk.values.get("sequence"));
  assertTrue(reopened.enqueue("page-failed",null,state,"incident-2"));assertEquals(2,reopened.outbox().length());
 }
 @Test public void retriedAdmissionAcknowledgesExistingFullyWriterWithoutDuplicatingItsTransition() throws Exception {
  Disk disk=new Disk();HomeWatchdogStorage storage=new HomeWatchdogStorage(disk.open());HomeWatchState home=new HomeWatchState();
  FkbAlertState fully=new FkbAlertState(true);fully.observe(false);disk.succeeds=false;
  fully.deliver(event->storage.enqueue(event,null,home,""));assertFalse(fully.ready());
  disk.succeeds=true;storage.retryAlert();fully.deliver(event->storage.enqueue(event,null,home,""));
  assertTrue(fully.ready());assertEquals(1,storage.outbox().length());
  fully.observe(true);fully.deliver(event->storage.enqueue(event,null,home,""));assertEquals(2,storage.outbox().length());
 }
 @Test public void retriedHomeLossReconcilesObservationAndDoesNotConsumeFutureLoss() throws Exception {
  Disk disk=new Disk();SharedPreferences prefs=disk.open();HomeWatchdogStorage storage=new HomeWatchdogStorage(prefs);
  HomeWatchState home=new HomeWatchState();String fully="de.ozerov.fully/.LauncherReplacement";
  home.observe(fully,1000);storage.enqueue("home-restored",fully,home,"");
  String loss=home.observe("other/.Home",2000);disk.succeeds=false;
  try{storage.enqueue(loss,home.home,home,"");fail();}catch(IllegalStateException expected){
   home.initialized=prefs.getBoolean("initialized",false);home.homeCorrect=prefs.getBoolean("correct",false);home.incidents=prefs.getLong("incidents",0);
  }
  disk.succeeds=true;storage.retryBeforeObserve(home);
  String restored=home.observe(fully,3000);assertEquals("home-restored",restored);
  storage.enqueue(restored,home.home,home,"");storage.enqueue("policy-restored",home.home,home,"");
  String laterLoss=home.observe("other/.Home",4000);assertEquals("home-lost",laterLoss);
  assertTrue(storage.enqueue(laterLoss,home.home,home,""));assertEquals(2,home.incidents);
  assertEquals(5,storage.outbox().length());assertEquals("home-lost",storage.outbox().getJSONObject(4).getString("event"));
 }
 @Test public void policyMarkerCommitsAtomicallyAndLaterTransitionsAreNotDeduplicated() throws Exception {
  Disk disk=new Disk();SharedPreferences prefs=disk.open();HomeWatchdogStorage storage=new HomeWatchdogStorage(prefs);HomeWatchState home=new HomeWatchState();
  disk.succeeds=false;
  try{storage.enqueue("policy-lost",null,home,"");fail();}catch(IllegalStateException expected){}
  assertTrue(prefs.getBoolean("policySecured",true));assertFalse(disk.values.containsKey("outbox"));
  disk.succeeds=true;storage.retryBeforeObserve(home);
  assertFalse(prefs.getBoolean("policySecured",true));assertEquals(false,disk.values.get("policySecured"));
  assertEquals(1,storage.outbox().length());
  // The recomputing policy producer sees its committed marker, so no second lost event is proposed.
  boolean secured=false;assertEquals(secured,prefs.getBoolean("policySecured",true));
  assertTrue(storage.enqueue("policy-restored",null,home,""));assertTrue(prefs.getBoolean("policySecured",false));
  assertTrue(storage.enqueue("policy-lost",null,home,""));assertFalse(prefs.getBoolean("policySecured",true));
  assertEquals(3,storage.outbox().length());
 }
 @Test public void interveningHomeAdmissionDoesNotConsumeFullyWriterReceipt() throws Exception {
  Disk disk=new Disk();HomeWatchdogStorage storage=new HomeWatchdogStorage(disk.open());HomeWatchState home=new HomeWatchState();
  FkbAlertState fully=new FkbAlertState(true);fully.observe(false);disk.succeeds=false;
  fully.deliver(event->storage.enqueue(event,null,home,"page-before"));assertFalse(fully.ready());
  disk.succeeds=true;storage.retryAlert();
  storage.enqueue("home-lost",null,home,"page-after");
  fully.deliver(event->storage.enqueue(event,null,home,"page-after"));
  assertTrue(fully.ready());assertEquals(2,storage.outbox().length());
  assertEquals("fkb-lost",storage.outbox().getJSONObject(0).getString("event"));
  assertEquals("home-lost",storage.outbox().getJSONObject(1).getString("event"));
  fully.observe(true);fully.deliver(event->storage.enqueue(event,null,home,"page-after"));
  fully.observe(false);fully.deliver(event->storage.enqueue(event,null,home,"page-after"));
  assertEquals(4,storage.outbox().length());
  assertEquals("fkb-restored",storage.outbox().getJSONObject(2).getString("event"));
  assertEquals("fkb-lost",storage.outbox().getJSONObject(3).getString("event"));
 }
 @Test public void interveningFailedHomeAdmissionDoesNotOverwriteFullyWriterReceipt() throws Exception {
  Disk disk=new Disk();HomeWatchdogStorage storage=new HomeWatchdogStorage(disk.open());HomeWatchState home=new HomeWatchState();
  FkbAlertState fully=new FkbAlertState(true);fully.observe(false);disk.succeeds=false;
  fully.deliver(event->storage.enqueue(event,null,home,""));
  disk.succeeds=true;storage.retryAlert();disk.succeeds=false;
  try{storage.enqueue("home-lost",null,home,"");fail();}catch(IllegalStateException expected){}
  disk.succeeds=true;storage.retryBeforeObserve(home);
  fully.deliver(event->storage.enqueue(event,null,home,""));assertTrue(fully.ready());
  assertNull(home.observe("other/.Home",1000));assertEquals(2,storage.outbox().length());
  fully.observe(true);fully.deliver(event->storage.enqueue(event,null,home,""));assertEquals(3,storage.outbox().length());
 }
 @Test public void serviceRestartCannotMistakeFailedPreferenceMemoryForDurableAdmission() throws Exception {
  Disk disk=new Disk();SharedPreferences sameProcess=disk.open();disk.succeeds=false;HomeWatchState state=new HomeWatchState();
  try{new HomeWatchdogStorage(sameProcess).enqueue("page-failed",null,state,"incident-1");fail();}catch(IllegalStateException expected){}
  disk.succeeds=true;HomeWatchdogStorage restarted=new HomeWatchdogStorage(sameProcess);
  assertTrue(restarted.enqueue("page-failed",null,state,"incident-1"));
  assertEquals(1,restarted.outbox().length());assertEquals("incident-1",disk.values.get("pageFailureIncident"));
 }
 @Test public void processDeathBeforeFailedAlertRetryLeavesNoFalseDurableAcknowledgement() throws Exception {
  Disk disk=new Disk();disk.succeeds=false;HomeWatchState state=new HomeWatchState();
  try{new HomeWatchdogStorage(disk.open()).enqueue("page-failed",null,state,"incident-1");fail();}catch(IllegalStateException expected){}
  disk.succeeds=true;HomeWatchdogStorage restarted=new HomeWatchdogStorage(disk.open());
  assertTrue(restarted.enqueue("page-failed",null,state,"incident-1"));assertEquals(1,restarted.outbox().length());
 }
}
