package net.kckern.portalkeys;

import android.content.Intent;
import android.content.ComponentName;
import android.net.Uri;
import android.test.InstrumentationTestCase;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

/** Run ONLY on the explicitly selected Portal after serving the fixture at its allowed HTTPS origin.
 * This launches real Fully. Compilation/desktop tests are not transport evidence.
 */
public class PageHeartbeatTransportTest extends InstrumentationTestCase {
    public void testActualFullyHttpsPageReachesNativeLoopback() throws Exception {
        android.content.Context target=getInstrumentation().getTargetContext();
        String origin=target.getSharedPreferences("home-watchdog",0).getString("pageOrigin","");
        assertTrue("Provision the exact HTTPS origin through authenticated /page/config",origin.startsWith("https://"));
        String activity=java.util.UUID.randomUUID().toString(), build="device-proof-"+System.currentTimeMillis();
        Intent intent=new Intent(Intent.ACTION_VIEW,Uri.parse(origin+"/portal-page-probe.html?activityId="+activity+"&build="+build));
        intent.setComponent(new ComponentName("de.ozerov.fully","de.ozerov.fully.FullyActivity"));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        target.startActivity(intent);
        long deadline=android.os.SystemClock.elapsedRealtime()+30000;
        while(android.os.SystemClock.elapsedRealtime()<deadline) {
            HttpURLConnection connection=(HttpURLConnection)new URL("http://127.0.0.1:8773/status").openConnection();
            connection.setRequestProperty("X-Portal-Token",AdminToken.get(target));
            connection.setConnectTimeout(1000);connection.setReadTimeout(1000);
            try {
                java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
                try(java.io.InputStream input=connection.getInputStream()) {
                    byte[] bytes=new byte[4096];int size;
                    while((size=input.read(bytes))!=-1) { assertTrue(output.size()+size<65536);output.write(bytes,0,size); }
                }
                JSONObject page=new JSONObject(output.toString("UTF-8")).getJSONObject("homeWatchdog").getJSONObject("page");
                if(activity.equals(page.optString("activityId")) && build.equals(page.optString("build")) && page.optLong("beatAgeMs",99999)<10000) {
                    assertFalse("Physical proof does not enable recovery",page.getBoolean("recoveryEnabled"));return;
                }
            } finally { connection.disconnect(); }
            Thread.sleep(1000);
        }
        fail("Actual Fully HTTPS page did not reach native loopback; retain recovery gate and investigate mixed content/CORS/private-network policy");
    }
}
