import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.net.*;
import java.io.*;
import java.util.*;
import org.json.*;
import org.junit.runner.*;
import org.junit.runner.notification.*;

/** Trusted confinement controls and observer; never replaces product assertions. */
public final class JvmLaneControl {
  private static final Set<String> EXPECTED = new TreeSet<>(Arrays.asList(
    "driftFound_writesOnlyTheDriftedKeys_withTheRightSetterPerType",
    "noDrift_writesNothing",
    "installHold_writesNothing",
    "installHoldExpires_andTheGuardResumes",
    "installHold_survivesTheServiceRestartTheInstallItselfCauses",
    "installHold_takesTheLaterOfInMemoryAndPersisted_persistedWins",
    "installHold_takesTheLaterOfInMemoryAndPersisted_inMemoryWins",
    "installHold_bothExpired_lettingTheGuardRun",
    "installHoldDeadlineIsAbsolute_soShorteningTheDurationCannotCutItShort",
    "disarmed_readsNothingAndWritesNothing",
    "disarmExpires_andTheGuardResumes",
    "disabled_readsNothingAndWritesNothing",
    "emptyPassword_readsNothing_andLogsExactlyOnceAcrossManyTicks",
    "readFailure_writesNothing",
    "forceCheck_bypassesAnActiveInstallHold",
    "forceCheck_isStillRefusedWhileDisarmed",
    "forceCheck_isStillRefusedWhileDisabled",
    "forceCheck_reportsDriftedAndRepairedKeysSeparately",
    "forceCheck_onACleanKioskReportsOkAndRepairsNothing",
    "rearm_clearsThePersistedDeadlineNotJustTheInMemoryOne",
    "rearm_worksAfterTheServiceRestart_theExactScenarioThatFailed",
    "aGuardReconstructedAfterRearmIsArmed",
    "rearm_reportsFailureHonestlyWhenThePersistedWriteFails",
    "disarm_reportsFailureHonestlyWhenThePersistedWriteFails",
    "rearm_worksEvenWhenTheCachedConfigIsStale_theRealDeviceMechanism",
    "anExplicitClearBeatsAStalePersistedDeadline_disarm",
    "anExplicitClearBeatsAStalePersistedDeadline_installHold",
    "snapshotTracksVerdictDriftCountAndRepairsSinceBoot",
    "foreground_otherApp_isRecalledOnFirstSight",
    "foreground_settingsGetsGrace_countedFromFirstLeavingFkb",
    "foreground_hoppingAppsCannotRestartTheGrace",
    "foreground_recallThatDidNotTake_isRetried_withoutSpammingNotes",
    "foreground_fkbInFront_doesNothing_andUnknownIsNotARecall",
    "foreground_respectsDisarmAndInstallHold",
    "standDown_longerThanAnHour_isCappedToOneHour"
  ));
  private static void require(boolean ok, String message) {
    if (!ok) throw new AssertionError(message);
  }
  private static void deniedWrite(Path path) throws Exception {
    try (OutputStream ignored=Files.newOutputStream(path,StandardOpenOption.WRITE,StandardOpenOption.APPEND)) {
      throw new AssertionError("outside write permitted");
    } catch (AccessDeniedException expected) {
      // Concrete filesystem denial, not missing file / parse / startup failure.
    } catch (FileSystemException e) {
      require("Permission denied".equals(e.getReason()),"wrong outside-write error: "+e);
    }
  }
  private static boolean networkInitializationDenied(ExceptionInInitializerError e) {
    Throwable c=e.getCause();
    if(c==null||c.getClass()!=IOException.class||c.getCause()!=null||!"Operation not permitted".equals(c.getMessage()))return false;
    StackTraceElement[] outer=e.getStackTrace(),cause=c.getStackTrace();
    return outer.length>0&&outer[0].getClassName().equals("sun.nio.ch.NioSocketImpl")&&outer[0].getMethodName().equals("<clinit>")&&
      cause.length>0&&cause[0].getClassName().equals("sun.nio.ch.UnixDispatcher")&&cause[0].getMethodName().equals("init")&&cause[0].isNativeMethod();
  }
  private static ExceptionInInitializerError shaped(Throwable cause,String outer,String inner,String method,int line) {
    cause.setStackTrace(new StackTraceElement[]{new StackTraceElement(inner,method,"UnixDispatcher.java",line)});
    ExceptionInInitializerError e=new ExceptionInInitializerError(cause);
    e.setStackTrace(new StackTraceElement[]{new StackTraceElement(outer,"<clinit>","NioSocketImpl.java",79)});return e;
  }
  private static void networkMatcherControls() {
    String outer="sun.nio.ch.NioSocketImpl",inner="sun.nio.ch.UnixDispatcher";
    require(networkInitializationDenied(shaped(new IOException("Operation not permitted"),outer,inner,"init",-2)),"exact observed network-init shape rejected");
    require(!networkInitializationDenied(shaped(new IllegalStateException("Operation not permitted"),outer,inner,"init",-2)),"wrong cause accepted");
    require(!networkInitializationDenied(shaped(new IOException("Permission denied"),outer,inner,"init",-2)),"wrong message accepted");
    require(!networkInitializationDenied(shaped(new IOException("Operation not permitted"),"other.Initializer",inner,"init",-2)),"wrong outer frame accepted");
    require(!networkInitializationDenied(shaped(new IOException("Operation not permitted"),outer,"other.Dispatcher","init",-2)),"wrong cause frame accepted");
    require(!networkInitializationDenied(shaped(new IOException("Operation not permitted"),outer,inner,"other",-2)),"wrong method accepted");
    require(!networkInitializationDenied(shaped(new IOException("Operation not permitted"),outer,inner,"init",65)),"nonnative frame accepted");
    require(!networkInitializationDenied(shaped(new IOException("Operation not permitted",new IOException("other")),outer,inner,"init",-2)),"nested unrelated cause accepted");
  }
  private static JSONObject deniedSocket(String host) throws Exception {
    boolean connectExercised=false;
    try (Socket s=new Socket()) {
      connectExercised=true;s.connect(new InetSocketAddress(InetAddress.getByName(host),9),500);
      throw new AssertionError("outbound permitted");
    } catch (SocketException e) {
      require("Operation not permitted".equals(e.getMessage()),"wrong socket denial: "+e);
      return new JSONObject().put("outboundConnectExercised",connectExercised).put("connectionDenied",connectExercised).put("networkInitializationDenied",false);
    } catch (ExceptionInInitializerError e) {
      if(connectExercised||!networkInitializationDenied(e))throw e;
      return new JSONObject().put("outboundConnectExercised",false).put("connectionDenied",false).put("networkInitializationDenied",true);
    }
  }
  private static boolean processStartDenied(String message) {
    if(message==null)return false;
    String prefix="Cannot run program \"/usr/bin/true\": ";
    return message.equals(prefix+"error=1, Operation not permitted") ||
      message.equals(prefix+"error=13, Permission denied") ||
      message.startsWith(prefix+"posix_spawn failed, error: 1 (Operation not permitted) \nPossible reasons:\n");
  }
  private static void processMatcherControls() {
    String observed="Cannot run program \"/usr/bin/true\": posix_spawn failed, error: 1 (Operation not permitted) \nPossible reasons:\n  - Spawn helper ran into JDK version mismatch";
    require(processStartDenied(observed),"observed JDK21 denial rejected");
    require(processStartDenied("Cannot run program \"/usr/bin/true\": error=1, Operation not permitted"),"legacy EPERM rejected");
    require(processStartDenied("Cannot run program \"/usr/bin/true\": error=13, Permission denied"),"legacy EACCES rejected");
    require(!processStartDenied(observed.replace("/usr/bin/true","/usr/bin/other")),"wrong program accepted");
    require(!processStartDenied(observed.replace("error: 1","error: 2")),"wrong code accepted");
    require(!processStartDenied(observed.replace("Operation not permitted","No such file or directory")),"wrong message accepted");
    require(!processStartDenied("unrelated error=1, Operation not permitted"),"generic EPERM accepted");
    require(!processStartDenied(null),"null error accepted");
  }
  public static final class KnownFailureControl {
    @org.junit.Test public void knownFailure(){org.junit.Assert.fail("fixed negative assertion control");}
  }
  public static final class KnownSkipControl {
    @org.junit.Ignore("fixed negative skip control") @org.junit.Test public void skipped(){throw new AssertionError("must not run");}
  }
  public static void main(String[] args) throws Exception {
    require(args.length==2,"fixed arguments required");
    Path role=Paths.get(args[0]).toRealPath(),report=Paths.get(args[1]).toAbsolutePath();
    Path cwd=Paths.get("").toAbsolutePath().toRealPath();
    JSONObject admission=new JSONObject(Files.readString(role.resolve("admission.json")));
    require(admission.getString("role").equals(role.getFileName().toString()),"role mismatch");
    require(Paths.get(System.getProperty("user.home")).toRealPath().equals(cwd.resolve("home")),"HOME escaped");
    require(Paths.get(System.getProperty("java.io.tmpdir")).toRealPath().equals(cwd.resolve("tmp")),"tmp escaped");
    require(report.equals(cwd.resolve("junit-result.json")),"report escaped");
    Path nonceFile=cwd.resolve("tmp/control-nonce.txt");
    String nonce=admission.getString("nonce");
    require(nonce.matches("[0-9a-f]{64}"),"nonce format");
    Files.writeString(nonceFile,nonce,StandardOpenOption.CREATE_NEW);
    require(Files.readString(nonceFile).equals(nonce),"scratch write/read failed");
    deniedWrite(role.resolve("payload/src/test/java/net/kckern/pianobridge/KioskSettingsGuardTest.java"));
    networkMatcherControls();
    JSONObject network=deniedSocket("127.0.0.1");
    if(!network.getBoolean("networkInitializationDenied")) {
      JSONObject remote=deniedSocket("192.0.2.1");
      require(remote.getBoolean("outboundConnectExercised")&&remote.getBoolean("connectionDenied"),"remote socket denial incomplete");
    }
    // Initialization-denied branch cannot attempt a second socket after failed clinit.
    // C direct socket errno==EPERM remains mandatory regardless of this branch.
    // The real C filter already separately checks socket/fork errno==EPERM.
    processMatcherControls();
    try {
      Process p=new ProcessBuilder("/usr/bin/true").start();
      p.destroyForcibly();throw new AssertionError("process permitted");
    } catch (IOException e) {
      require(processStartDenied(e.getMessage()),"wrong process denial: "+e);
    }
    Result negativeFailure=JUnitCore.runClasses(KnownFailureControl.class);
    require(!negativeFailure.wasSuccessful()&&negativeFailure.getRunCount()==1&&negativeFailure.getFailureCount()==1&&negativeFailure.getFailures().get(0).getMessage().equals("fixed negative assertion control"),"negative assertion control did not fail honestly");
    Result negativeSkip=JUnitCore.runClasses(KnownSkipControl.class);
    require(negativeSkip.getRunCount()==0&&negativeSkip.getIgnoreCount()==1,"negative skip control incomplete");
    SortedSet<String> declared=new TreeSet<>();
    Class<?> test=Class.forName("net.kckern.pianobridge.KioskSettingsGuardTest");
    for(java.lang.reflect.Method m:test.getDeclaredMethods())
      if(m.isAnnotationPresent(org.junit.Test.class)) declared.add(m.getName());
    require(declared.equals(EXPECTED),"test declarations differ from pinned35");
    List<String> started=new ArrayList<>(),finished=new ArrayList<>(),ignored=new ArrayList<>();
    JSONArray failures=new JSONArray(),assumptions=new JSONArray();
    JUnitCore core=new JUnitCore();
    core.addListener(new RunListener(){
      public void testStarted(Description d){started.add(d.getMethodName());}
      public void testFinished(Description d){finished.add(d.getMethodName());}
      public void testIgnored(Description d){ignored.add(d.getMethodName());}
      public void testFailure(Failure f){failures.put(new JSONObject().put("name",f.getDescription().getMethodName()).put("trace",f.getTrace()));}
      public void testAssumptionFailure(Failure f){assumptions.put(new JSONObject().put("name",f.getDescription().getMethodName()).put("trace",f.getTrace()));}
    });
    Result result=core.run(test);
    boolean complete=started.size()==35&&finished.size()==35&&new TreeSet<>(started).equals(EXPECTED)&&new TreeSet<>(finished).equals(EXPECTED)&&ignored.isEmpty()&&result.getIgnoreCount()==0&&assumptions.length()==0&&result.getRunCount()==35;
    boolean correct=complete&&result.wasSuccessful()&&failures.length()==0;
    JSONObject receipt=new JSONObject().put("schema","daylight.fixed-jvm-role/v1")
      .put("admission",admission).put("javaVersion",System.getProperty("java.runtime.version"))
      .put("controls",true).put("network",network).put("networkMatcherControls",true).put("processMatcherControls",true).put("processStartDenied",true).put("negativeAssertionObserved",true).put("negativeSkipObserved",true).put("completed",complete).put("correctness",correct)
      .put("runCount",result.getRunCount()).put("started",started).put("finished",finished)
      .put("ignored",ignored).put("failures",failures).put("assumptions",assumptions)
      .put("failureCount",result.getFailureCount()).put("ignoreCount",result.getIgnoreCount());
    Files.writeString(report,receipt.toString(2)+"\n",StandardOpenOption.CREATE_NEW);
    System.out.println("JVM35 completed="+complete+" correctness="+correct+" runCount="+result.getRunCount());
    System.exit(correct?0:1);
  }
}
