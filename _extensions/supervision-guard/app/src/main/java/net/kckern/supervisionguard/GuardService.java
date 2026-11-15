package net.kckern.supervisionguard;
import android.app.*;
import android.app.admin.DevicePolicyManager;
import android.content.*;
import android.os.*;
import android.util.Log;
import java.io.*;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;
/** Device-owner package control. Network I/O cannot block the local expiry loop. */
public final class GuardService extends Service {
 private final Handler handler=new Handler(Looper.getMainLooper());
 private final ExecutorService network=Executors.newSingleThreadExecutor();
 private DevicePolicyManager policy;private ComponentName admin;private SharedPreferences order;private PowerManager.WakeLock awake;
 private LeaseDeadline lease;private String endpoint,credential,target;private volatile boolean ready=false,blocked=true;private boolean fetching=false,destroyed=false;
 @Override public void onCreate(){super.onCreate();NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("supervision","Parent supervision",NotificationManager.IMPORTANCE_LOW));startForeground(1,new Notification.Builder(this,"supervision").setSmallIcon(android.R.drawable.ic_lock_lock).setContentTitle("Parent supervision active").setVisibility(Notification.VISIBILITY_SECRET).build());
  Context storage=createDeviceProtectedStorageContext();order=storage.getSharedPreferences("ordering",MODE_PRIVATE);lease=new LeaseDeadline(order.getLong("epoch",-1),order.getLong("revision",-1),order.getBoolean("blocked",true));
  policy=getSystemService(DevicePolicyManager.class);admin=new ComponentName(this,GuardAdmin.class);awake=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Daylight:supervision-lease");awake.setReferenceCounted(false);
  try{File file=new File(storage.getFilesDir(),"native-supervision.json");if(file.length()>8192)throw new IOException();JSONObject config=new JSONObject(read(new FileInputStream(file)));endpoint=config.getString("endpoint");credential=config.getString("credential");target=config.getString("packageName");URL url=new URL(endpoint);if(!"https".equals(url.getProtocol()) || url.getUserInfo()!=null || url.getQuery()!=null || credential.length()<32 || !target.matches("[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z][a-zA-Z0-9_]*)+") || target.equals(getPackageName()))throw new IOException();
   if(!policy.isDeviceOwnerApp(getPackageName()))throw new SecurityException();policy.setUninstallBlocked(admin,getPackageName(),true);
   if(Build.VERSION.SDK_INT>=30)policy.setUserControlDisabledPackages(admin,java.util.Collections.singletonList(getPackageName()));
   enforce(true);
  }catch(Exception error){ready=false;target=null;credential=null;endpoint=null;Log.w("SupervisionGuard","Local enforcement not provisioned");}
  handler.post(tick);handler.post(poll);
 }
 private static String read(InputStream stream)throws IOException{try(InputStream in=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] bytes=new byte[1024];int length;while((length=in.read(bytes))!=-1){if(out.size()+length>8192)throw new IOException();out.write(bytes,0,length);}return out.toString("UTF-8");}}
 private void enforce(boolean desired){
  if(target==null || !policy.isDeviceOwnerApp(getPackageName())){ready=false;blocked=true;return;}
  try{boolean actual=policy.isApplicationHidden(admin,target);if(actual!=desired && !policy.setApplicationHidden(admin,target,desired))throw new SecurityException();blocked=policy.isApplicationHidden(admin,target);ready=blocked==desired;if(!ready)lease.revoke();}catch(Exception error){ready=false;lease.revoke();Log.w("SupervisionGuard","Package restriction unverified");}
  if(desired && awake.isHeld())awake.release();
 }
 private final Runnable tick=new Runnable(){public void run(){if(destroyed)return;enforce(lease.blocked(SystemClock.elapsedRealtime()));handler.postDelayed(this,100);}};
 private final Runnable poll=new Runnable(){public void run(){if(destroyed)return;if(!fetching && endpoint!=null && credential!=null && target!=null){fetching=true;final long started=SystemClock.elapsedRealtime();final boolean localReady=ready,localBlocked=blocked;final long epoch=lease.epoch(),revision=lease.revision();network.execute(()->{
   JSONObject reply=null;HttpsURLConnection connection=null;
   try{connection=(HttpsURLConnection)new URL(endpoint).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(1500);connection.setReadTimeout(1500);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Authorization","Bearer "+credential);connection.setRequestProperty("Content-Type","application/json");JSONObject ack=new JSONObject().put("protocol",1).put("capabilityReady",localReady).put("blocked",localBlocked).put("epoch",epoch).put("commandRevision",revision);byte[] bytes=new JSONObject().put("packageName",target).put("ack",ack).toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream out=connection.getOutputStream()){out.write(bytes);}if(connection.getResponseCode()==200)reply=new JSONObject(read(connection.getInputStream()));}catch(Exception error){/* Existing lease expires locally; never log bearer or response. */}finally{if(connection!=null)connection.disconnect();}
   final JSONObject result=reply;handler.post(()->{fetching=false;if(destroyed || result==null)return;try{if(result.getInt("protocol")!=1)throw new IllegalArgumentException();lease.accept(started,SystemClock.elapsedRealtime(),result.getLong("epoch"),result.getLong("commandRevision"),result.getBoolean("blockedCommand"),result.getBoolean("allowed"),result.getLong("leaseMs"));boolean persisted=order.edit().putLong("epoch",lease.epoch()).putLong("revision",lease.revision()).putBoolean("blocked",lease.desiredBlocked()).commit();if(!persisted)lease.revoke();if(!lease.blocked(SystemClock.elapsedRealtime()))awake.acquire(6000);enforce(lease.blocked(SystemClock.elapsedRealtime()));}catch(Exception error){lease.revoke();enforce(true);}});
  });}handler.postDelayed(this,1000);}};
 @Override public int onStartCommand(Intent intent,int flags,int id){return START_STICKY;}
 @Override public IBinder onBind(Intent intent){return null;}
 @Override public void onDestroy(){destroyed=true;handler.removeCallbacksAndMessages(null);lease.revoke();enforce(true);network.shutdownNow();super.onDestroy();}
}
