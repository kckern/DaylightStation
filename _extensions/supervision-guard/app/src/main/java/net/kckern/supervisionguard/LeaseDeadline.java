package net.kckern.supervisionguard;
/** Monotonic, request-start bounded. Persist only ordering, never a reusable lease. */
public final class LeaseDeadline {
 private long epoch, revision, deadline=0; private boolean desiredBlocked;
 public LeaseDeadline(){this(-1,-1,true);}
 public LeaseDeadline(long savedEpoch,long savedRevision,boolean savedBlocked){epoch=savedEpoch;revision=savedRevision;desiredBlocked=savedBlocked;}
 public synchronized boolean accept(long started,long now,long nextEpoch,long nextRevision,boolean blockedCommand,boolean allowed,long duration){
  if(nextEpoch<0 || nextRevision<0 || nextEpoch<epoch || nextRevision<revision || (nextEpoch==epoch && nextRevision==revision && blockedCommand!=desiredBlocked))return false;
  epoch=nextEpoch;revision=nextRevision;desiredBlocked=blockedCommand;
  if(!allowed || blockedCommand){deadline=0;return true;}
  if(started<0 || now<started || duration<=0 || duration>5000 || started>Long.MAX_VALUE-duration || now>=started+duration){deadline=0;return false;}
  deadline=started+duration;return true;
 }
 public synchronized boolean blocked(long now){return deadline==0 || now>=deadline;}
 public synchronized void revoke(){deadline=0;}
 public synchronized long epoch(){return epoch;}
 public synchronized long revision(){return revision;}
 public synchronized boolean desiredBlocked(){return desiredBlocked;}
}
