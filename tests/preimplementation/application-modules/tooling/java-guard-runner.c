/* Fixed confined Java/JUnit launcher; parent must validate all pins first.
 * Sibling fixed launcher reuses the current confinement helpers without changing
 * any Node admission or syscall policy. Coordinator must validate all pins first.
 */
#define main existing_node_lane_main
#include "landlock-runner.c"
#undef main
static const char *java_bin = "/usr/lib/jvm/java-21-openjdk-amd64/bin/java";
static const char *dependency_cp = "/home/ds/.gradle/caches/modules-2/files-2.1/org.json/json/20231013/e22e0c040fe16f04ffdb85d851d77b07fc05ea52/json-20231013.jar:/home/ds/.gradle/caches/modules-2/files-2.1/junit/junit/4.13.2/8ac9e16d933b6fb43bc7f576336b8f4d7eb5ba12/junit-4.13.2.jar:/home/ds/.gradle/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core/1.3/42a25dc3219429f0e5d060061f71acb49bf010a0/hamcrest-core-1.3.jar:/home/ds/.gradle/caches/modules-2/files-2.1/org.nanohttpd/nanohttpd/2.3.1/a8d54d1ca554a77f377eff6bf9e16ca8383c8f6c/nanohttpd-2.3.1.jar:/home/ds/.gradle/caches/modules-2/files-2.1/org.nanohttpd/nanohttpd-websocket/2.3.1/f2cfb09cee12469ff64f0d698b13de19903bb4f7/nanohttpd-websocket-2.3.1.jar:/home/ds/.gradle/caches/transforms-3/72f4bc8566060ab742533f3b9abe3130/transformed/android.jar";
static const char *selected_sources[] = {
  "payload/src/main/java/net/kckern/pianobridge/A11y.java",
  "payload/src/main/java/net/kckern/pianobridge/A2dpConnector.java",
  "payload/src/main/java/net/kckern/pianobridge/AndroidAudioOps.java",
  "payload/src/main/java/net/kckern/pianobridge/AudioGuardPolicy.java",
  "payload/src/main/java/net/kckern/pianobridge/AudioRouteGuard.java",
  "payload/src/main/java/net/kckern/pianobridge/BleMidiConnector.java",
  "payload/src/main/java/net/kckern/pianobridge/BridgeCore.java",
  "payload/src/main/java/net/kckern/pianobridge/ControlServer.java",
  "payload/src/main/java/net/kckern/pianobridge/CrashLog.java",
  "payload/src/main/java/net/kckern/pianobridge/DeviceConfig.java",
  "payload/src/main/java/net/kckern/pianobridge/DeviceProbe.java",
  "payload/src/main/java/net/kckern/pianobridge/Diag.java",
  "payload/src/main/java/net/kckern/pianobridge/FkbRest.java",
  "payload/src/main/java/net/kckern/pianobridge/Heartbeat.java",
  "payload/src/main/java/net/kckern/pianobridge/KioskSettings.java",
  "payload/src/main/java/net/kckern/pianobridge/KioskSettingsGuard.java",
  "payload/src/main/java/net/kckern/pianobridge/KioskWatchdog.java",
  "payload/src/main/java/net/kckern/pianobridge/Loopback.java",
  "payload/src/main/java/net/kckern/pianobridge/ProcStats.java",
  "payload/src/main/java/net/kckern/pianobridge/ScreenWaker.java",
  "payload/src/main/java/net/kckern/pianobridge/SettingsControl.java",
  "payload/src/main/java/net/kckern/pianobridge/ShellExec.java",
  "payload/src/main/java/net/kckern/pianobridge/StatusPage.java",
  "payload/src/main/java/net/kckern/pianobridge/SystemDiagnostics.java",
  "payload/src/main/java/net/kckern/pianobridge/TouchPulser.java",
  "payload/src/main/java/net/kckern/pianobridge/Updater.java",
  "shell-api/src/main/java/net/kckern/pianobridge/PianoEngine.java",
  "shell-api/src/main/java/net/kckern/pianobridge/api/ShellServices.java",
  "payload/src/test/java/net/kckern/pianobridge/KioskSettingsGuardTest.java"
};
static const char *runtime_files[] = {
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/tzdb.dat",
  "/lib/x86_64-linux-gnu/libz.so.1",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/modules",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/jrt-fs.jar",
  "/etc/java-21-openjdk/jvm-amd64.cfg",
  "/etc/java-21-openjdk/security/java.security",
  "/etc/java-21-openjdk/net.properties",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libjli.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libjava.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libjimage.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libverify.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libzip.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libnio.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/libnet.so",
  "/usr/lib/jvm/java-21-openjdk-amd64/lib/server/libjvm.so",
  "/lib/x86_64-linux-gnu/libdl.so.2",
  "/lib/x86_64-linux-gnu/libstdc++.so.6",
  "/lib/x86_64-linux-gnu/libm.so.6",
  "/lib/x86_64-linux-gnu/libgcc_s.so.1",
  "/lib/x86_64-linux-gnu/libpthread.so.0",
  "/lib/x86_64-linux-gnu/libc.so.6",
  "/lib64/ld-linux-x86-64.so.2",
  "/home/ds/.gradle/caches/modules-2/files-2.1/junit/junit/4.13.2/8ac9e16d933b6fb43bc7f576336b8f4d7eb5ba12/junit-4.13.2.jar",
  "/home/ds/.gradle/caches/modules-2/files-2.1/org.hamcrest/hamcrest-core/1.3/42a25dc3219429f0e5d060061f71acb49bf010a0/hamcrest-core-1.3.jar",
  "/home/ds/.gradle/caches/modules-2/files-2.1/org.json/json/20231013/e22e0c040fe16f04ffdb85d851d77b07fc05ea52/json-20231013.jar",
  "/home/ds/.gradle/caches/modules-2/files-2.1/org.nanohttpd/nanohttpd/2.3.1/a8d54d1ca554a77f377eff6bf9e16ca8383c8f6c/nanohttpd-2.3.1.jar",
  "/home/ds/.gradle/caches/modules-2/files-2.1/org.nanohttpd/nanohttpd-websocket/2.3.1/f2cfb09cee12469ff64f0d698b13de19903bb4f7/nanohttpd-websocket-2.3.1.jar",
  "/home/ds/.gradle/caches/transforms-3/72f4bc8566060ab742533f3b9abe3130/transformed/android.jar"
};
static char *join(const char *root, const char *leaf) {
  char *p; if (asprintf(&p,"%s/%s",root,leaf)<0) fail("path"); return p;
}
int main(int argc, char **argv) {
  /* Only path roots and enumerated phase/role; never commands, flags, or cp. */
  if(argc!=5 || (strcmp(argv[3],"compile")&&strcmp(argv[3],"run")) ||
     (strcmp(argv[4],"original")&&strcmp(argv[4],"candidate"))) return 2;
  char *inputs=realpath(argv[1],NULL),*scratch=realpath(argv[2],NULL);
  if(!inputs||!scratch) fail("realpath");
  if(!strcmp(inputs,scratch) || !strncmp(inputs,scratch,strlen(scratch)) ||
     !strncmp(scratch,inputs,strlen(inputs))) { fprintf(stderr,"roots overlap\n"); return 2; }
  char *role=join(inputs,argv[4]),*classes=join(scratch,"classes");
  char *admission=join(role,"admission.json");
  char *tmp=join(scratch,"tmp"),*home=join(scratch,"home");
  char *report=join(scratch,"junit-result.json");
  int compile=!strcmp(argv[3],"compile");
  char *log=join(scratch,compile?"compile.log":"test.log");
  int out=open(log,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC,0600);
  int in=open("/dev/null",O_RDONLY|O_CLOEXEC);
  if(out<0||in<0||dup2(in,0)<0||dup2(out,1)<0||dup2(out,2)<0) fail("stdio");
  close(out);close(in);
  struct { uint64_t fs,net,scoped; } a={.fs=(1ULL<<16)-1,.net=0,.scoped=3};
  int fd=syscall(SYS_landlock_create_ruleset,&a,sizeof(a),0);
  if(fd<0) fail("create ruleset");
  uint64_t writes=a.fs & ~(LANDLOCK_ACCESS_FS_EXECUTE|LANDLOCK_ACCESS_FS_MAKE_CHAR|
    LANDLOCK_ACCESS_FS_MAKE_BLOCK|LANDLOCK_ACCESS_FS_MAKE_SOCK|LANDLOCK_ACCESS_FS_MAKE_FIFO|(1ULL<<15));
  rule(fd,scratch,writes); /* No scratch execution or device/IPC nodes. */
  rule(fd,java_bin,LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_EXECUTE);
  for(unsigned i=0;i<sizeof(runtime_files)/sizeof(runtime_files[0]);i++)
    rule(fd,runtime_files[i],LANDLOCK_ACCESS_FS_READ_FILE|
      (!strcmp(runtime_files[i],"/lib64/ld-linux-x86-64.so.2")?LANDLOCK_ACCESS_FS_EXECUTE:0));
  rule(fd,admission,LANDLOCK_ACCESS_FS_READ_FILE);
  char *args[100];int n=0;
  args[n++]=(char*)java_bin;args[n++]="-Xmx512m";args[n++]="-XX:MaxMetaspaceSize=192m";
  args[n++]="-XX:ReservedCodeCacheSize=64m";args[n++]="-XX:+UseSerialGC";
  args[n++]="-XX:ActiveProcessorCount=2";args[n++]="-XX:-UsePerfData";
  args[n++]="-Xshare:off";args[n++]="-Djava.awt.headless=true";
  char *p;if(asprintf(&p,"-Duser.home=%s",home)<0) fail("home");args[n++]=p;
  if(asprintf(&p,"-Djava.io.tmpdir=%s",tmp)<0) fail("tmp");args[n++]=p;
  if(asprintf(&p,"-XX:ErrorFile=%s/hs_err_pid%%p.log",scratch)<0) fail("hs_err");args[n++]=p;
  if(compile) {
    args[n++]="--module";args[n++]="jdk.compiler/com.sun.tools.javac.Main";
    args[n++]="-source";args[n++]="11";args[n++]="-target";args[n++]="11";args[n++]="-proc:none";
    args[n++]="-implicit:none";args[n++]="-classpath";args[n++]=(char*)dependency_cp;
    args[n++]="-d";args[n++]=classes;
    for(unsigned i=0;i<sizeof(selected_sources)/sizeof(selected_sources[0]);i++) {
      char *source=join(role,selected_sources[i]);
      rule(fd,source,LANDLOCK_ACCESS_FS_READ_FILE);args[n++]=source;
    }
    /* Fixed trusted control/reporting entry; never product or oracle substitutes. */
    char *control=join(inputs,"JvmLaneControl.java");
    rule(fd,control,LANDLOCK_ACCESS_FS_READ_FILE);args[n++]=control;
  } else {
    /* Compile-phase pins and full class-file hashes must be verified by parent. */
    args[n++]="-cp";if(asprintf(&p,"%s:%s",classes,dependency_cp)<0) fail("cp");args[n++]=p;
    args[n++]="JvmLaneControl";args[n++]=role;args[n++]=report;
    for(unsigned i=0;i<sizeof(selected_sources)/sizeof(selected_sources[0]);i++)
      rule(fd,join(role,selected_sources[i]),LANDLOCK_ACCESS_FS_READ_FILE);
  }
  args[n]=NULL;
  limit(RLIMIT_CPU,45);limit(RLIMIT_FSIZE,4*1024*1024);limit(RLIMIT_NOFILE,128);
  limit(RLIMIT_CORE,0);limit(RLIMIT_AS,4ULL*1024*1024*1024);
  if(chdir(scratch)) fail("chdir");
  if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)) fail("no new privs");
  if(syscall(SYS_landlock_restrict_self,fd,0)) fail("restrict self");close(fd);
  if(syscall(SYS_close_range,3,~0U,0)) fail("close_range");
  alarm(60);filter(0,0); /* Thread clone allowed; nonthread fork/clone/socket denied. */
  errno=0;int s=socket(AF_INET,SOCK_STREAM,0);
  if(s!=-1||errno!=EPERM) fail("socket control");
  errno=0;if(syscall(SYS_fork)!=-1||errno!=EPERM) fail("fork control");
  errno=0;int denied=open(join(role,selected_sources[0]),O_WRONLY|O_APPEND|O_CLOEXEC);
  if(denied!=-1||errno!=EACCES) fail("outside write control");
  fprintf(stdout,"JVM C CONTROLS PASS: socket EPERM; fork EPERM; outside-write EACCES\n");
  fflush(stdout);
  char *homeenv,*tmpenv;
  if(asprintf(&homeenv,"HOME=%s",home)<0||asprintf(&tmpenv,"TMPDIR=%s",tmp)<0) fail("env");
  char *env[]={homeenv,tmpenv,"PATH=/nonexistent","LANG=C.UTF-8","TZ=UTC",NULL};
  execve(java_bin,args,env);fail("exec java");
}
