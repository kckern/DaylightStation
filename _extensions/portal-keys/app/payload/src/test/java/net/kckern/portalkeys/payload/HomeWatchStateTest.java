package net.kckern.portalkeys.payload;
import org.junit.Test;
import static org.junit.Assert.*;
public class HomeWatchStateTest {
 @Test public void acceptsOnlyFullyHomeActivities(){
  assertTrue(HomeWatchState.isFullyHome("de.ozerov.fully/.LauncherReplacement"));
  assertTrue(HomeWatchState.isFullyHome("de.ozerov.fully/de.ozerov.fully.FakeLauncher"));
  assertFalse(HomeWatchState.isFullyHome("de.ozerov.fully/.FullyActivity"));
  assertFalse(HomeWatchState.isFullyHome("com.immortal.launcher/.HomeActivity"));
  assertFalse(HomeWatchState.isFullyHome("android/com.android.internal.app.ResolverActivity"));
  assertFalse(HomeWatchState.isFullyHome(null));
 }
 @Test public void recordsLossAndRecoveryWithoutRepeatedPollAlerts(){
  HomeWatchState s=new HomeWatchState();
  assertNull(s.observe("de.ozerov.fully/.LauncherReplacement",1));
  assertEquals("home-lost",s.observe("com.immortal.launcher/.HomeActivity",2));
  assertNull(s.observe("com.immortal.launcher/.HomeActivity",3));
  assertEquals("home-restored",s.observe("de.ozerov.fully/.LauncherReplacement",4));
  assertEquals(1,s.incidents);
  assertEquals("home-lost",s.observe(null,5));assertEquals(2,s.incidents);
 }
 @Test public void unknownAtStartupIsAnIncident(){
  HomeWatchState s=new HomeWatchState();assertEquals("home-lost",s.observe(null,1));
  assertFalse(s.homeCorrect);assertNull(s.observe(null,2));assertFalse(s.homeCorrect);
 }
}
