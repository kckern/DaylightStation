package net.kckern.portalkeys.payload;

/** Pure monotonic page policy; device I/O belongs to HomeWatchdog. */
final class PageWatchState {
    enum State { HEALTHY, SUPPRESSED, DEGRADED, FAILED, RECOVERED }
    enum Action { NONE, FOREGROUND_LOAD, RESTART_RENDERER }
    static final class Decision {
        final State state; final Action action; final boolean allowed;
        Decision(State state, Action action) { this.state=state; this.action=action; this.allowed=action!=Action.NONE; }
    }
    private long baseline, observedBeat=-1, stageAt;
    private int stage;
    private boolean incident;
    final java.util.ArrayList<Long> restarts=new java.util.ArrayList<>();
    long blockedUntil;
    Decision evaluate(long now, long lastBeat, boolean awake, boolean stopped, boolean maintenance) {
        if (!awake || stopped || maintenance) {
            baseline=now; stage=0; incident=false; observedBeat=lastBeat;
            return new Decision(State.SUPPRESSED,Action.NONE);
        }
        if (lastBeat>observedBeat && lastBeat>0) {
            boolean recovered=incident;
            observedBeat=lastBeat; baseline=lastBeat; stage=0; incident=false;
            if (recovered) return new Decision(State.RECOVERED,Action.NONE);
        }
        if (now-Math.max(baseline,lastBeat)<15000) return new Decision(State.HEALTHY,Action.NONE);
        incident=true;
        restarts.removeIf(at -> now-at>=600000);
        if (stage==0) { stage=1; stageAt=now; return new Decision(State.DEGRADED,Action.FOREGROUND_LOAD); }
        if (now-stageAt<15000) return new Decision(State.DEGRADED,Action.NONE);
        if (stage==1) {
            if (now<blockedUntil || restarts.size()>=2) return new Decision(State.FAILED,Action.NONE);
            restarts.add(now); stage=2; stageAt=now;
            return new Decision(State.DEGRADED,Action.RESTART_RENDERER);
        }
        stage=1; stageAt=now;
        return new Decision(State.DEGRADED,Action.FOREGROUND_LOAD);
    }
}
