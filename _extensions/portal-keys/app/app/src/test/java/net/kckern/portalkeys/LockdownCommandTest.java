package net.kckern.portalkeys;
import org.junit.Test;
import static org.junit.Assert.*;
public class LockdownCommandTest {
  @Test public void rejectsMalformedOrMissingLockInsteadOfClearing() throws Exception {
    for(String body:new String[]{"{}","{broken","{\"locked\":\"false\"}","{\"locked\":false,\"revision\":1.5}","{\"locked\":false,\"revision\":null}","{\"locked\":false} trailing"}) {
      try {LockdownCommand.parse(body,1000);fail("accepted invalid command: "+body);} catch(IllegalArgumentException expected){}
    }
  }
  @Test public void indefiniteStopAndReleaseUseOrderedDistinctRevisions() throws Exception {
    LockdownCommand stop=LockdownCommand.parse("{\"locked\":true,\"lockedUntil\":null,\"revision\":2}",1000);
    assertEquals(Long.MAX_VALUE,stop.deadline());assertTrue(stop.canApply(1,0));assertTrue(stop.canApply(2,Long.MAX_VALUE));
    LockdownCommand release=LockdownCommand.parse("{\"locked\":false,\"revision\":3}",1000);
    assertTrue(release.canApply(2,Long.MAX_VALUE));assertEquals(0,release.deadline());
    assertFalse(stop.canApply(3,0));
    assertFalse(LockdownCommand.parse("{\"locked\":false,\"revision\":2}",1000).canApply(2,Long.MAX_VALUE));
  }
  @Test public void legacyWritersCannotClearANewerOrderedParentStop() throws Exception {
    LockdownCommand legacy=LockdownCommand.parse("{\"locked\":false}",1000);
    assertTrue(legacy.canApply(0,Long.MAX_VALUE));assertFalse(legacy.canApply(2,Long.MAX_VALUE));
  }
  @Test public void rejectsExpiredDeadlinesAndUnsafeRevisions() throws Exception {
    for(String body:new String[]{"{\"locked\":true,\"lockedUntil\":999}","{\"locked\":true,\"revision\":0}","{\"locked\":true,\"revision\":9007199254740992}"}) {
      try {LockdownCommand.parse(body,1000);fail("accepted invalid command");}catch(IllegalArgumentException expected){}
    }
  }
}
