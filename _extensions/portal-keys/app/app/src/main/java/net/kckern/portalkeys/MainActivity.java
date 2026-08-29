package net.kckern.portalkeys;
import android.app.Activity;import android.content.Intent;import android.os.Bundle;
public class MainActivity extends Activity{@Override protected void onCreate(Bundle b){super.onCreate(b);startForegroundService(new Intent(this,PortalBridgeService.class));finish();}}
