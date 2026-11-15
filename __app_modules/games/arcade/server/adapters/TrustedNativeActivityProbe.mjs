const quote=value=>`'${String(value).replaceAll("'", "'\\''")}'`;
/** Reads the actual live emulator process and its open load log. No intent/self-report fallback. */
export class TrustedNativeActivityProbe {
  #adb;#package;#directory;#clock;#resolve;
  constructor({adbAdapter,packageName,logDir,clock,resolveContent}){if(!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(packageName) || !logDir)throw new TypeError('Native process/log configuration required');this.#adb=adbAdapter;this.#package=packageName;this.#directory=logDir;this.#clock=clock;this.#resolve=resolveContent;}
  async observe(){
    const observedAt=this.#clock.now(),unknown={state:'unknown',observedAt};
    if(!this.#adb?.shellArgv)return unknown;
    const result=await this.#adb.shellArgv(`pid=$(pidof ${this.#package}); if [ -z "$pid" ]; then printf IDLE; exit; fi
case "$pid" in *[!0-9]*) exit;; esac
cd ${quote(this.#directory)} || exit
file=$(ls -1 retroarch__*.log 2>/dev/null | sort | tail -n 1)
[ -n "$file" ] || exit
printf '%s\\n' "$pid"
printf '%s\\n' "$(cat /proc/$pid/stat 2>/dev/null)"
printf '%s\\n' "$(cat /proc/uptime)"
printf '%s\\n' "$(getconf CLK_TCK)"
printf '%s\\n' "$(date +%s)"
printf '%s\\n' "$file"
printf '%s\\n' "$(stat -c %Y "$file")"
printf '%s\\n' "$(grep 'Loading content file:' "$file" | tail -n 1)"
for fd in /proc/$pid/fd/*; do link=$(readlink "$fd" 2>/dev/null); case "$link" in */"$file") printf OPEN; break;; esac; done`);
    if(!result?.ok)return unknown;const output=result.output?.trim();if(output==='IDLE')return {state:'idle',observedAt};
    const [pid,stat,uptime,ticks,wall,file,mtime,line,open]=output?.split('\n')??[];
    if(!/^\d+$/.test(pid??'') || !/^retroarch__\d{4}_\d{2}_\d{2}__\d{2}_\d{2}_\d{2}\.log$/.test(file??'') || open!=='OPEN')return unknown;
    const fields=stat?.slice(stat.lastIndexOf(')')+2).split(/\s+/),startTicks=Number(fields?.[19]),rate=Number(ticks),up=Number(uptime?.split(' ')[0]),deviceWall=Number(wall),modified=Number(mtime);
    if(![startTicks,rate,up,deviceWall,modified].every(Number.isFinite) || rate<=0 || startTicks<=0 || up<startTicks/rate || modified<deviceWall-(up-startTicks/rate)-1)return unknown;
    const path=/Loading content file:\s*"([^"]+)"/.exec(line??'')?.[1],content=path && this.#resolve?.(path);
    return content?.contentId?{state:'running',contentId:content.contentId,observedAt}:unknown;
  }
}
