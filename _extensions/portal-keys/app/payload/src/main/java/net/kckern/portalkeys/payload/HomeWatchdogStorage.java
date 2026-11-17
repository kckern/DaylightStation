package net.kckern.portalkeys.payload;

import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** Persistence seam of HomeWatchdog; uses its existing preferences and outbox, not another authority. */
final class HomeWatchdogStorage {
    private final SharedPreferences prefs;
    private java.util.function.BooleanSupplier pendingAlertCommit;
    private String pendingEvent,pendingIncident,retriedEvent,retriedIncident;
    HomeWatchdogStorage(SharedPreferences prefs) { this.prefs=prefs; }
    void restoreBudget(PageWatchState page,long now,int boot) {
        try {
            JSONArray prior=new JSONArray(prefs.getString("pageRestarts","[]"));
            if ((prior.length()>0 || prefs.getLong("pageBlockedUntil",0)>0) && (boot<0 || boot!=prefs.getInt("pageBoot",-2)))
                page.blockedUntil=now+600000;
            else {
                page.blockedUntil=prefs.getLong("pageBlockedUntil",0);
                for(int i=0;i<prior.length();i++) page.restarts.add(prior.getLong(i));
            }
        } catch(Exception unavailable) { page.blockedUntil=now+600000; }
    }
    void commitBudgetThen(PageWatchState page,int boot,Runnable action) {
        JSONArray times=new JSONArray();for(Long time:page.restarts)times.put(time);
        if(!prefs.edit().putString("pageRestarts",times.toString()).putInt("pageBoot",boot)
                .putLong("pageBlockedUntil",page.blockedUntil).commit()) throw new IllegalStateException("page-budget-storage-failed");
        action.run();
    }
    void retryAlert() {
        if(pendingAlertCommit==null)return;
        if(!pendingAlertCommit.getAsBoolean())throw new IllegalStateException("alert-storage-failed");
        pendingAlertCommit=null;
        retriedEvent=pendingEvent;retriedIncident=pendingIncident;
    }
    JSONArray outbox() throws Exception {
        // Android commit(false) can leave memory ahead of disk. Never deliver that view.
        if(pendingAlertCommit!=null)throw new IllegalStateException("alert-storage-pending");
        return new JSONArray(prefs.getString("outbox","[]"));
    }
    boolean enqueue(String event,String home,HomeWatchState state,String pageIncident) throws Exception {
        retryAlert();
        boolean retryAcknowledged=event.equals(retriedEvent) && pageIncident.equals(retriedIncident);
        retriedEvent=null;retriedIncident=null;
        if(retryAcknowledged)return false;
        if(event.equals("page-failed") && pageIncident.equals(prefs.getString("pageFailureIncident","")))return false;
        JSONArray queue=outbox();
        String oldQueue=queue.toString(),oldFailure=prefs.getString("pageFailureIncident","");
        long oldSequence=prefs.getLong("sequence",0),oldIncidents=prefs.getLong("incidents",0);
        boolean oldInitialized=prefs.getBoolean("initialized",false),oldCorrect=prefs.getBoolean("correct",false),oldSecure=prefs.getBoolean("fkbSecure",true);
        if(queue.length()>=128)throw new IllegalStateException("alert-outbox-full");
        long sequence=prefs.getLong("sequence",0)+1;
        queue.put(new JSONObject().put("event",event).put("sequence",sequence).put("at",state.checkedAt)
                .put("home",home==null?JSONObject.NULL:home).put("incidents",state.incidents).put("device","school-portal")
                .put("incidentId",event.equals("page-failed")?pageIncident:JSONObject.NULL)
                .put("stage",event).put("payload",Main.VERSION).put("atIso",java.time.Instant.now().toString()));
        String encoded=queue.toString();
        boolean correct=state.homeCorrect;long incidents=state.incidents;
        String failure=event.equals("page-failed")?pageIncident:prefs.getString("pageFailureIncident","");
        boolean secure=event.startsWith("fkb-")?event.equals("fkb-restored"):prefs.getBoolean("fkbSecure",true);
        // Capture a whole transaction, not just the marker. Retry even if preference memory
        // already contains it; only successful commit acknowledges durable admission.
        pendingEvent=event;pendingIncident=pageIncident;
        pendingAlertCommit=() -> {
            boolean saved=prefs.edit().putLong("sequence",sequence).putString("outbox",encoded)
                    .putBoolean("initialized",true).putBoolean("correct",correct).putLong("incidents",incidents)
                    .putString("pageFailureIncident",failure).putBoolean("fkbSecure",secure).commit();
            if(!saved) {
                // Restore the acknowledged view in Android's cached memory even if disk
                // is still failing. A replacement service must not inherit a false ACK.
                prefs.edit().putLong("sequence",oldSequence).putString("outbox",oldQueue)
                        .putBoolean("initialized",oldInitialized).putBoolean("correct",oldCorrect).putLong("incidents",oldIncidents)
                        .putString("pageFailureIncident",oldFailure).putBoolean("fkbSecure",oldSecure).commit();
            }
            return saved;
        };
        retryAlert();
        // This caller received the successful admission. Only a later retry needs a receipt.
        retriedEvent=null;retriedIncident=null;
        return true;
    }
}
