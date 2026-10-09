#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <libgen.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/ioctl.h>
#include <sys/syscall.h>
#include <unistd.h>

static void fail(const char *s) { perror(s); exit(2); }
static void rule(int fd, const char *path, uint64_t rights) {
  int p = open(path, O_PATH | O_CLOEXEC);
  if (p < 0) fail(path);
  struct landlock_path_beneath_attr a = {.allowed_access=rights,.parent_fd=p};
  if (syscall(SYS_landlock_add_rule,fd,LANDLOCK_RULE_PATH_BENEATH,&a,0)) fail("add rule");
  close(p);
}
#define ALLOW(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_##n,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
#define HTTP_ALLOW(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_##n,0,1), BPF_STMT(BPF_RET|BPF_K,local_http?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM))
static void filter(int children, int local_http) {
  struct sock_filter f[] = {
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AUDIT_ARCH_X86_64,1,0),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
    /* Only the readiness child may create IPv4 stream sockets. connect remains denied. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_socket,0,10),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_INET,0,7),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])),
    BPF_STMT(BPF_ALU|BPF_AND|BPF_K,0xf),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SOCK_STREAM,0,4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[2])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,1,0),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,6,0,1),
    BPF_STMT(BPF_RET|BPF_K,local_http?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
    HTTP_ALLOW(bind),HTTP_ALLOW(listen),HTTP_ALLOW(accept),HTTP_ALLOW(accept4),
    /* clone3 cannot safely inspect its pointer argument; glibc retries clone. */
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_clone3,0,1),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|ENOSYS),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_clone,0,7),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,CLONE_THREAD,1,0),
    BPF_STMT(children?(BPF_JMP|BPF_JA):(BPF_RET|BPF_K),children?0:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_STMT(BPF_ALU|BPF_AND|BPF_K,~((children?(CLONE_VFORK|0xff):0)|CLONE_VM|CLONE_FS|CLONE_FILES|CLONE_SIGHAND|CLONE_THREAD|CLONE_SYSVSEM|CLONE_SETTLS|CLONE_PARENT_SETTID|CLONE_CHILD_CLEARTID|CLONE_CHILD_SETTID|CLONE_DETACHED)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,0,1,0),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_ioctl,0,4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[1])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,FIONBIO,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_fork,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_vfork,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_kill,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_tgkill,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_socketpair,0,4),
    BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AF_UNIX,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_sendmsg,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_recvmsg,0,1),
    BPF_STMT(BPF_RET|BPF_K,children?SECCOMP_RET_ALLOW:(SECCOMP_RET_ERRNO|EPERM)),
    ALLOW(wait4),ALLOW(waitid),
    ALLOW(getsockname),ALLOW(getpeername),ALLOW(getsockopt),ALLOW(setsockopt),ALLOW(shutdown),
    ALLOW(read),ALLOW(write),ALLOW(readv),ALLOW(writev),ALLOW(close),
    ALLOW(openat),ALLOW(newfstatat),ALLOW(fstat),ALLOW(stat),ALLOW(lstat),
    ALLOW(statx),ALLOW(lseek),ALLOW(pread64),ALLOW(pwrite64),
    ALLOW(mmap),ALLOW(mprotect),ALLOW(munmap),ALLOW(mremap),ALLOW(madvise),ALLOW(brk),
    ALLOW(rt_sigaction),ALLOW(rt_sigprocmask),ALLOW(rt_sigreturn),ALLOW(sigaltstack),
    ALLOW(futex),ALLOW(futex_waitv),ALLOW(set_tid_address),ALLOW(set_robust_list),ALLOW(rseq),
    ALLOW(clock_gettime),ALLOW(clock_nanosleep),ALLOW(nanosleep),ALLOW(gettimeofday),
    ALLOW(getpid),ALLOW(getppid),ALLOW(gettid),ALLOW(getuid),ALLOW(geteuid),
    ALLOW(getgid),ALLOW(getegid),ALLOW(umask),ALLOW(arch_prctl),ALLOW(getrandom),
    ALLOW(sched_getaffinity),ALLOW(sched_yield),ALLOW(sched_getparam),ALLOW(sched_getscheduler),
    ALLOW(getrlimit),ALLOW(getrusage),ALLOW(sysinfo),ALLOW(uname),
    ALLOW(epoll_create1),ALLOW(epoll_ctl),ALLOW(epoll_wait),ALLOW(epoll_pwait),
    ALLOW(eventfd2),ALLOW(pipe2),ALLOW(poll),ALLOW(ppoll),ALLOW(select),ALLOW(pselect6),
    ALLOW(fcntl),ALLOW(dup),ALLOW(dup2),ALLOW(dup3),ALLOW(readlink),ALLOW(readlinkat),
    ALLOW(copy_file_range),ALLOW(sendfile),ALLOW(timerfd_create),ALLOW(timerfd_settime),ALLOW(timerfd_gettime),
    ALLOW(getcwd),ALLOW(chdir),ALLOW(getdents64),ALLOW(access),ALLOW(faccessat),ALLOW(faccessat2),
    ALLOW(mkdir),ALLOW(mkdirat),ALLOW(unlink),ALLOW(unlinkat),ALLOW(rmdir),
    ALLOW(rename),ALLOW(renameat),ALLOW(renameat2),ALLOW(link),ALLOW(linkat),
    ALLOW(symlink),ALLOW(symlinkat),ALLOW(truncate),ALLOW(ftruncate),ALLOW(fsync),ALLOW(fdatasync),
    ALLOW(execve),ALLOW(exit),ALLOW(exit_group),
    BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM)
  };
  struct sock_fprog p = {.len=sizeof(f)/sizeof(f[0]),.filter=f};
  if (prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&p)) fail("seccomp");
}
static void limit(int resource, rlim_t n) {
  struct rlimit r={n,n}; if (setrlimit(resource,&r)) fail("rlimit");
}
int main(int argc,char **argv) {
  if (argc != 11) { fprintf(stderr,"usage: landlock-runner scratch node manifest toolroot loader entry outside pack target baseline-receipt\n"); return 2; }
  if (strcmp(argv[8],"main-chess") && (strcmp(argv[8],"main-school")&&strcmp(argv[8],"main-ghost")) && strcmp(argv[8],"gratitude") && strcmp(argv[8],"browser") && strcmp(argv[8],"stored-shape") && strcmp(argv[8],"build") && strcmp(argv[8],"integration") && strcmp(argv[8],"hook") && strcmp(argv[8],"m2") && strcmp(argv[8],"health-stack") && strcmp(argv[8],"health") && strcmp(argv[8],"school-fitness") && strcmp(argv[8],"school-http") && strcmp(argv[8],"bots-displays") && strcmp(argv[8],"media-content") && strcmp(argv[8],"media-presentation") && strcmp(argv[8],"bots-displays-node") && strcmp(argv[8],"media-content-node") && strcmp(argv[8],"bots-displays-jest") && strcmp(argv[8],"media-content-jest") && strcmp(argv[8],"gaming-notation") && strcmp(argv[8],"gaming-notation-node") && strcmp(argv[8],"agents-life-diagnostic") && (strcmp(argv[8],"agents-life-concierge")&&strcmp(argv[8],"readiness-http")) && strcmp(argv[8],"agents-life-http") && strcmp(argv[8],"content-api") && strcmp(argv[8],"epaper-http") && strcmp(argv[8],"remaining-operations") && strcmp(argv[8],"remaining-feed") && strcmp(argv[8],"remaining-camera") && strcmp(argv[8],"remaining-games") && strcmp(argv[8],"remaining-home") && strcmp(argv[8],"remaining-workflows") && strcmp(argv[8],"remaining-media-tools") && strcmp(argv[8],"remaining-art") && strcmp(argv[8],"remaining-node") && strcmp(argv[8],"remaining-jest") && strcmp(argv[8],"remaining-http") && strcmp(argv[8],"agents-life-config") && strcmp(argv[8],"remaining-stockfish") && strcmp(argv[8],"progress-store") && strcmp(argv[8],"art-screens") && strcmp(argv[8],"piano-retained-node") && strcmp(argv[8],"art-canvas") && strcmp(argv[8],"retained-supplement") && strcmp(argv[8],"retained-supplement-node") && (strcmp(argv[8],"retained-ti86")&&(strcmp(argv[8],"retained-ti86-native")&&strcmp(argv[8],"retained-ti86-gui")&&strcmp(argv[8],"retained-ti86-relay")))) { fprintf(stderr,"unsupported pack\n"); return 2; }
  if (strcmp(argv[9],"baseline") && strcmp(argv[9],"candidate")) { fprintf(stderr,"unsupported target\n"); return 2; }
  if (!strcmp(argv[9],"candidate") && strcmp(argv[8],"main-chess") && (strcmp(argv[8],"main-school")&&strcmp(argv[8],"main-ghost")) && strcmp(argv[8],"gratitude") && strcmp(argv[8],"browser") && strcmp(argv[8],"m2") && strcmp(argv[8],"health-stack") && strcmp(argv[8],"health") && strcmp(argv[8],"school-fitness") && strcmp(argv[8],"school-http") && strcmp(argv[8],"bots-displays") && strcmp(argv[8],"media-content") && strcmp(argv[8],"media-presentation") && strcmp(argv[8],"bots-displays-node") && strcmp(argv[8],"media-content-node") && strcmp(argv[8],"bots-displays-jest") && strcmp(argv[8],"media-content-jest") && strcmp(argv[8],"gaming-notation") && strcmp(argv[8],"gaming-notation-node") && strcmp(argv[8],"agents-life-diagnostic") && (strcmp(argv[8],"agents-life-concierge")&&strcmp(argv[8],"readiness-http")) && strcmp(argv[8],"agents-life-http") && strcmp(argv[8],"content-api") && strcmp(argv[8],"epaper-http") && strcmp(argv[8],"remaining-operations") && strcmp(argv[8],"remaining-feed") && strcmp(argv[8],"remaining-camera") && strcmp(argv[8],"remaining-games") && strcmp(argv[8],"remaining-home") && strcmp(argv[8],"remaining-workflows") && strcmp(argv[8],"remaining-media-tools") && strcmp(argv[8],"remaining-art") && strcmp(argv[8],"remaining-node") && strcmp(argv[8],"remaining-jest") && strcmp(argv[8],"remaining-http") && strcmp(argv[8],"agents-life-config") && strcmp(argv[8],"remaining-stockfish") && strcmp(argv[8],"progress-store") && strcmp(argv[8],"art-screens") && strcmp(argv[8],"piano-retained-node") && strcmp(argv[8],"art-canvas") && strcmp(argv[8],"retained-supplement") && strcmp(argv[8],"retained-supplement-node") && (strcmp(argv[8],"retained-ti86")&&(strcmp(argv[8],"retained-ti86-native")&&strcmp(argv[8],"retained-ti86-gui")&&strcmp(argv[8],"retained-ti86-relay")))) return 2;
  int local_http=!strcmp(argv[8],"readiness-http");
  char *scratch=realpath(argv[1],NULL),*node=realpath(argv[2],NULL),*outside=realpath(argv[7],NULL);
  if (!scratch || !node || !outside) fail("realpath");
  char output[4096];
  if (snprintf(output,sizeof(output),"%s/result.txt",scratch) >= (int)sizeof(output)) fail("output path");
  int out=open(output,O_WRONLY|O_CREAT|O_TRUNC|O_CLOEXEC,0600);
  int in=open("/dev/null",O_RDONLY|O_CLOEXEC);
  if (out<0 || in<0 || dup2(in,0)<0 || dup2(out,1)<0 || dup2(out,2)<0) fail("stdio");
  close(out); close(in);
  /* Requires Landlock ABI >=6: filesystem bits through IOCTL_DEV, both scopes. */
  struct { uint64_t fs,net,scoped; } a={.fs=(1ULL<<16)-1,.net=local_http?3:0,.scoped=3};
  int fd=syscall(SYS_landlock_create_ruleset,&a,sizeof(a),0);
  if (fd<0) fail("create ruleset");
  if (local_http) {
    /* Landlock limits TCP ports, not addresses: driver binds audited 127.0.0.1 only. */
    struct { uint64_t allowed_access, port; } net = {.allowed_access=1,.port=43129};
    if (syscall(SYS_landlock_add_rule,fd,2,&net,0)) fail("readiness TCP bind rule");
  }
  uint64_t ro=LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_EXECUTE;
  rule(fd,scratch,a.fs & ~(LANDLOCK_ACCESS_FS_MAKE_CHAR|LANDLOCK_ACCESS_FS_MAKE_BLOCK|LANDLOCK_ACCESS_FS_MAKE_SOCK|LANDLOCK_ACCESS_FS_MAKE_FIFO|(1ULL<<15)));
  rule(fd,node,ro);
  if (!strcmp(argv[8],"hook")||!strcmp(argv[8],"retained-supplement-node")||!(strcmp(argv[8],"retained-ti86")&&(strcmp(argv[8],"retained-ti86-native")&&strcmp(argv[8],"retained-ti86-gui")&&strcmp(argv[8],"retained-ti86-relay")))) rule(fd,"/dev/null",LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE);
  const char *libs[]={"/lib/x86_64-linux-gnu/libdl.so.2","/lib/x86_64-linux-gnu/libstdc++.so.6","/lib/x86_64-linux-gnu/libm.so.6","/lib/x86_64-linux-gnu/libgcc_s.so.1","/lib/x86_64-linux-gnu/libpthread.so.0","/lib/x86_64-linux-gnu/libc.so.6","/lib64/ld-linux-x86-64.so.2"};
  for (unsigned i=0;i<sizeof(libs)/sizeof(libs[0]);i++) rule(fd,libs[i],ro);
  FILE *manifest=fopen(argv[3],"r");
  if (!manifest) fail("manifest");
  char *line=NULL; size_t capacity=0; ssize_t length;
  while ((length=getline(&line,&capacity,manifest))>=0) {
    if (length<4 || line[length-1]!='\n' || line[1]!='\t') fail("manifest entry");
    line[length-1]=0;
    if (line[0]!='F' && line[0]!='D' && line[0]!='X' && line[0]!='L') fail("manifest type");
    rule(fd,line+2,line[0]=='L'?LANDLOCK_ACCESS_FS_READ_DIR:LANDLOCK_ACCESS_FS_READ_FILE|(line[0]=='D'?LANDLOCK_ACCESS_FS_READ_DIR:0)|(line[0]=='X'?LANDLOCK_ACCESS_FS_EXECUTE:0));
  }
  if (ferror(manifest)) fail("manifest read");
  free(line); fclose(manifest);
  int children=strcmp(argv[8],"gratitude")!=0;
  int hook=strcmp(argv[8],"hook")==0;
  int build=strcmp(argv[8],"build")==0 || hook;
  int longpack=!strcmp(argv[8],"main-chess")||!(strcmp(argv[8],"main-school")&&strcmp(argv[8],"main-ghost"))||!(strcmp(argv[8],"retained-ti86")&&(strcmp(argv[8],"retained-ti86-native")&&strcmp(argv[8],"retained-ti86-gui")&&strcmp(argv[8],"retained-ti86-relay")))||!strcmp(argv[8],"retained-supplement")||!strcmp(argv[8],"retained-supplement-node")||!strcmp(argv[8],"art-screens")||!strcmp(argv[8],"progress-store")||!strcmp(argv[8],"school-fitness")||!strcmp(argv[8],"health-stack")||!strcmp(argv[8],"bots-displays")||!strcmp(argv[8],"media-content")||!strcmp(argv[8],"media-presentation")||!strcmp(argv[8],"bots-displays-node")||!strcmp(argv[8],"media-content-node")||!strcmp(argv[8],"bots-displays-jest")||!strcmp(argv[8],"media-content-jest")||!strcmp(argv[8],"gaming-notation")||!strcmp(argv[8],"gaming-notation-node")||!strcmp(argv[8],"agents-life-config")||!strcmp(argv[8],"agents-life-diagnostic")||!(strcmp(argv[8],"agents-life-concierge")&&strcmp(argv[8],"readiness-http"))||!strcmp(argv[8],"agents-life-http")||!strcmp(argv[8],"content-api")||!strcmp(argv[8],"epaper-http")||!strcmp(argv[8],"remaining-operations")||!strcmp(argv[8],"remaining-feed")||!strcmp(argv[8],"remaining-camera")||!strcmp(argv[8],"remaining-games")||!strcmp(argv[8],"remaining-home")||!strcmp(argv[8],"remaining-workflows")||!strcmp(argv[8],"remaining-media-tools")||!strcmp(argv[8],"remaining-art")||!strcmp(argv[8],"remaining-node")||!strcmp(argv[8],"remaining-jest")||!strcmp(argv[8],"remaining-http")||!strcmp(argv[8],"agents-life-config")||!strcmp(argv[8],"remaining-stockfish");
  limit(RLIMIT_CPU,build||longpack?180:20); limit(RLIMIT_FSIZE,!strcmp(argv[8],"remaining-media-tools")?2ULL*1024*1024*1024:(build?64:4)*1024*1024); limit(RLIMIT_NOFILE,build?256:128);
  int agents=!strcmp(argv[8],"art-canvas")||!strcmp(argv[8],"remaining-games")||!strcmp(argv[8],"remaining-stockfish")||!strcmp(argv[8],"agents-life-config")||!(strcmp(argv[8],"agents-life-concierge")&&strcmp(argv[8],"readiness-http"))||!strcmp(argv[8],"agents-life-diagnostic")||!strcmp(argv[8],"agents-life-http");
  limit(RLIMIT_CORE,0); limit(RLIMIT_AS,(build||agents?16ULL:(children?4ULL:2ULL))*1024*1024*1024);
  if (chdir(scratch)) fail("chdir");
  if (prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)) fail("no new privs");
  if (syscall(SYS_landlock_restrict_self,fd,0)) fail("restrict self");
  close(fd);
  if (syscall(SYS_close_range,3,~0U,0)) fail("close_range");
  alarm(hook?1800:(build||longpack?180:45));
  filter(children,local_http);
  errno=0; int s=socket(local_http?AF_UNIX:AF_INET,SOCK_STREAM,0);
  if (s!=-1 || errno!=EPERM) fail("socket unexpectedly permitted");
  fprintf(stdout,local_http?"socket(AF_UNIX): EPERM\n":"socket(AF_INET): EPERM\n");
  if (local_http) { errno=0; int rejected=socket(AF_INET,SOCK_STREAM,132); if(rejected!=-1||errno!=EPERM) fail("non-TCP protocol unexpectedly permitted"); fprintf(stdout,"non-TCP protocol: EPERM\n"); }
  if (local_http) { int pair[2]; if(socketpair(AF_UNIX,SOCK_STREAM,0,pair)) fail("anonymous IPC pair"); close(pair[0]);close(pair[1]);fprintf(stdout,"anonymous IPC pair: permitted\n"); }
  if (!children) {
  errno=0; long p=syscall(SYS_fork);
  if (p!=-1 || errno!=EPERM) fail("fork unexpectedly permitted");
  fprintf(stdout,"fork: EPERM\n");
  }
  if (hook) {
    char sentinel[4096];
    if (snprintf(sentinel,sizeof(sentinel),"%s/private.env",outside)>=(int)sizeof(sentinel)) fail("sentinel path");
    const char *paths[]={sentinel,"/etc/hostname","escape",argv[6]};
    for (unsigned i=0;i<4;i++) {
      errno=0; int probe=open(paths[i],i==3?O_WRONLY:O_RDONLY);
      if (probe!=-1 || errno!=EACCES) fail("hook filesystem control");
    }
    errno=0; if (truncate(sentinel,0)!=-1 || errno!=EACCES) fail("hook truncate control");
    fprintf(stdout,"HOOK FILESYSTEM CONTROLS PASS\n");
  }
  long calls[]={SYS_vfork,SYS_clone,SYS_socketpair,SYS_kill,SYS_process_vm_readv,
    SYS_pidfd_getfd,SYS_ptrace,SYS_mount,SYS_unshare,SYS_setns,SYS_bpf,
    SYS_keyctl,SYS_io_uring_setup};
  const char *names[]={"vfork","nonthread clone","socketpair","kill","process_vm_readv",
    "pidfd_getfd","ptrace","mount","unshare","setns","bpf","keyctl","io_uring_setup"};
  for (unsigned i=0;i<sizeof(calls)/sizeof(calls[0]);i++) {
    if (children && (calls[i]==SYS_vfork || calls[i]==SYS_clone || calls[i]==SYS_kill)) continue;
    errno=0;
    if (syscall(calls[i],0,0,0,0,0,0)!=-1 || errno!=EPERM) fail(names[i]);
    fprintf(stdout,"%s: EPERM\n",names[i]);
  }
  fflush(stdout);
  char *args[]={node,build?"--max-old-space-size=4096":((!strcmp(argv[8],"gaming-notation-node")||!strcmp(argv[8],"agents-life-config")||!strcmp(argv[8],"agents-life-diagnostic")||!(strcmp(argv[8],"agents-life-concierge")&&strcmp(argv[8],"readiness-http")))?"--max-old-space-size=1024":(children?"--max-old-space-size=256":"--max-old-space-size=64")),"--disable-wasm-trap-handler","--openssl-config=openssl.cnf","--test-reporter=tap","--experimental-loader",argv[5],argv[6],NULL};
  char *homeenv,*pathenv,*openssl,*npmcache,*npmconfig,*toolenv,*runenv,*denyenv,*tmpenv,*cacheenv,*packenv,*targetenv,*driverenv,*browserenv,*baselineenv;
  if (asprintf(&homeenv,"HOME=%s",scratch)<0 || asprintf(&pathenv,"PATH=%s:/usr/bin:/bin",dirname(strdup(node)))<0 || asprintf(&openssl,"OPENSSL_CONF=%s/openssl.cnf",scratch)<0 || asprintf(&npmcache,"npm_config_cache=%s/npm-cache",scratch)<0 || asprintf(&npmconfig,"npm_config_userconfig=%s/npmrc",scratch)<0 || asprintf(&targetenv,"PRE_TARGET=%s",argv[9])<0 ||
      asprintf(&baselineenv,"PRE_BASELINE_EVIDENCE=%s",argv[10])<0 ||
      asprintf(&browserenv,"PRE_CANDIDATE_BROWSER_DRIVER=%s/browser-candidate.mjs",dirname(strdup(argv[5])))<0 ||
      asprintf(&driverenv,"PRE_CANDIDATE_GRATITUDE_DRIVER=%s/gratitude-candidate.mjs",dirname(strdup(argv[5])))<0 || asprintf(&packenv,"PRE_PACK=%s",argv[8])<0 || asprintf(&toolenv,"PRE_TOOLCHAIN_ROOT=%s",argv[4])<0 ||
      asprintf(&runenv,"PRE_RUN_ROOT=%s",scratch)<0 ||
      asprintf(&denyenv,"PRE_DENIED_ROOT=%s",outside)<0 ||
      asprintf(&tmpenv,"TMPDIR=%s",scratch)<0 ||
      asprintf(&cacheenv,"XDG_CACHE_HOME=%s/cache",scratch)<0) fail("environment");
  char *nodeoptions=(hook||longpack)?"NODE_OPTIONS=--disable-wasm-trap-handler":"NODE_OPTIONS=";
  if (!strcmp(argv[8],"retained-ti86") && asprintf(&nodeoptions,"NODE_OPTIONS=--disable-wasm-trap-handler --import=%s/ti86-copy-preload.mjs",scratch)<0) fail("TI86 fixture preload");
  if (!strcmp(argv[8],"retained-ti86-gui") && asprintf(&nodeoptions,"NODE_OPTIONS=--disable-wasm-trap-handler --import=%s/ti86-release-preload.mjs",scratch)<0) fail("TI86 release fixture preload");
  char *env[]={nodeoptions,(hook||longpack)?pathenv:"PATH=/nonexistent",homeenv,openssl,npmcache,npmconfig,"GIT_CONFIG_NOSYSTEM=1","GIT_OPTIONAL_LOCKS=0",(!strcmp(argv[8],"health-stack")||!strcmp(argv[8],"remaining-camera")||!strcmp(argv[8],"remaining-http"))?"TZ=America/Los_Angeles":"TZ=UTC","UV_THREADPOOL_SIZE=2","ESBUILD_WORKER_THREADS=0","NODE_ENV=test","PRE_VITEST_MODE=stored-shape",
    packenv,targetenv,baselineenv,driverenv,browserenv,toolenv,runenv,denyenv,tmpenv,cacheenv,NULL};
  char *buildargs[]={node,"--max-old-space-size=4096","--disable-wasm-trap-handler","--openssl-config=openssl.cnf",argv[6],NULL};
  char *hookargs[]={"/bin/sh",argv[6],NULL};
  execve(hook?"/bin/sh":node,hook?hookargs:(build?buildargs:args),env); fail("exec node");
}
