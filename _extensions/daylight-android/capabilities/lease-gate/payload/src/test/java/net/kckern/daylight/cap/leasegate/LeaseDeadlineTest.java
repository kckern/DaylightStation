package net.kckern.daylight.cap.leasegate;
import org.junit.Test;
import static org.junit.Assert.*;
public class LeaseDeadlineTest {
 @Test public void stalledNetworkCannotExtendRequestStartDeadline(){LeaseDeadline lease=new LeaseDeadline();assertTrue(lease.blocked(1000));assertTrue(lease.accept(1000,4999,0,1,false,true,5000));assertFalse(lease.blocked(5999));assertTrue(lease.blocked(6000));assertFalse(lease.accept(1000,6001,0,1,false,true,5000));}
 @Test public void denyOldEpochAndConflictingRevisionCannotRelease(){LeaseDeadline lease=new LeaseDeadline();assertTrue(lease.accept(100,100,2,10,true,false,0));assertFalse(lease.accept(101,101,1,11,false,true,5000));assertFalse(lease.accept(101,101,2,9,false,true,5000));assertFalse(lease.accept(101,101,2,10,false,true,5000));assertTrue(lease.blocked(101));}
 @Test public void restartNeverRestoresThePreviousLease(){LeaseDeadline lease=new LeaseDeadline(2,10,false);assertTrue(lease.blocked(0));assertTrue(lease.accept(100,100,2,10,false,true,3000));assertFalse(lease.blocked(100));assertTrue(new LeaseDeadline(2,10,false).blocked(100));}
 @Test public void invalidDurationsAndFreshDenialCloseLocally(){LeaseDeadline lease=new LeaseDeadline();assertFalse(lease.accept(100,100,0,1,false,true,5001));assertTrue(lease.blocked(100));assertTrue(lease.accept(100,100,0,2,false,true,5000));assertTrue(lease.accept(200,200,0,2,false,false,0));assertTrue(lease.blocked(200));}
}
