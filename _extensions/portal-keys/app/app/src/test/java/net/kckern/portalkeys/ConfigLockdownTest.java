package net.kckern.portalkeys;

import android.content.SharedPreferences;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;
import org.junit.Test;
import static org.junit.Assert.*;

/** Disk and memory are deliberately separate: apply() is not a durable ACK. */
public class ConfigLockdownTest {
  static class Preferences {
    final Map<String,Object> disk=new HashMap<>();
    boolean commitSucceeds=true;
    SharedPreferences open() {
      Map<String,Object> memory=new HashMap<>(disk);
      return (SharedPreferences)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.class},(proxy,method,args)-> {
        if(method.getName().startsWith("get") && args!=null && args.length==2)return memory.getOrDefault(args[0],args[1]);
        if(method.getName().equals("edit")) {
          Map<String,Object> updates=new HashMap<>();
          return Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.Editor.class},(editor,operation,values)-> {
            if(operation.getName().startsWith("put")){updates.put((String)values[0],values[1]);return editor;}
            if(operation.getName().equals("commit")){if(!commitSucceeds)return false;memory.putAll(updates);disk.putAll(updates);return true;}
            if(operation.getName().equals("apply")){memory.putAll(updates);return null;}
            throw new UnsupportedOperationException(operation.getName());
          });
        }
        throw new UnsupportedOperationException(method.getName());
      });
    }
  }
  @Test public void acknowledgedStopSurvivesPowerLossAndRejectsDelayedRelease() {
    Preferences storage=new Preferences();Config config=new Config(storage.open());
    assertTrue(config.applyLockdown(LockdownCommand.parse("{\"locked\":true,\"revision\":4}",1000)));
    Config restarted=new Config(storage.open());
    assertTrue(restarted.lockdownActive());assertEquals(4,restarted.lockdownRevision());
    assertFalse(restarted.applyLockdown(LockdownCommand.parse("{\"locked\":false,\"revision\":3}",1000)));
    assertFalse(restarted.applyLockdown(LockdownCommand.parse("{\"locked\":false}",1000)));
    assertTrue(restarted.lockdownActive());
  }
  @Test public void failedPersistenceCannotAcknowledgeStop() {
    Preferences storage=new Preferences();storage.commitSucceeds=false;Config config=new Config(storage.open());
    try{config.applyLockdown(LockdownCommand.parse("{\"locked\":true,\"revision\":2}",1000));fail("acknowledged failed disk write");}
    catch(IllegalStateException expected){}
  }
  @Test public void retryAndExplicitReleaseSurviveRestart() {
    Preferences storage=new Preferences();Config config=new Config(storage.open());LockdownCommand stop=LockdownCommand.parse("{\"locked\":true,\"revision\":2}",1000);
    assertTrue(config.applyLockdown(stop));assertTrue(config.applyLockdown(stop));
    assertTrue(config.applyLockdown(LockdownCommand.parse("{\"locked\":false,\"revision\":3}",1000)));
    Config restarted=new Config(storage.open());assertFalse(restarted.lockdownActive());assertEquals(3,restarted.lockdownRevision());
  }
}
