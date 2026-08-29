package net.kckern.portalkeys;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import net.kckern.portalkeys.api.ShellServices;
import java.io.File;

public class PortalBridgeService extends Service {
    private PayloadLoader loader; private ShellServer server;
    @Override public void onCreate(){super.onCreate();ShellLog.install(this);NotificationChannel c=new NotificationChannel("portal_bridge","Portal Bridge",NotificationManager.IMPORTANCE_LOW);getSystemService(NotificationManager.class).createNotificationChannel(c);}
    @Override public int onStartCommand(Intent i,int flags,int id){
        Notification n=new Notification.Builder(this,"portal_bridge").setContentTitle("Portal Bridge").setContentText("Remote recovery active").setSmallIcon(android.R.drawable.ic_dialog_info).setOngoing(true).build();startForeground(16,n);
        if(server==null){server=new ShellServer(this);try{server.start(0,true);ShellLog.note("SHELL","lifeline :8772");}catch(Exception e){ShellLog.note("SHELL","lifeline failed "+e);}}
        if(loader==null){loader=new PayloadLoader(this,new Shell());loader.boot();}
        return START_STICKY;
    }
    @Override public void onDestroy(){if(loader!=null)loader.stop();if(server!=null)server.stop();super.onDestroy();}
    @Override public IBinder onBind(Intent i){return null;}
    PayloadLoader loader(){return loader;}
    int versionCode(){try{return getPackageManager().getPackageInfo(getPackageName(),0).versionCode;}catch(Exception e){return -1;}}
    private final class Shell implements ShellServices{
        public Object context(){return PortalBridgeService.this;} public Object accessibilityService(){return PortalKeysService.current();}
        public String adminToken(){return AdminToken.get(PortalBridgeService.this);}
        public int shellVersionCode(){return versionCode();} public File payloadDir(){return loader.store().dir();}
        public String requestPayloadSwap(String u,String s){return loader.swap(u,s);} public String requestPayloadRollback(){return loader.rollback();}
        public String payloadStatusJson(){return loader.status().toString();} public void note(String k,String m){ShellLog.note(k,m);}
    }
}
