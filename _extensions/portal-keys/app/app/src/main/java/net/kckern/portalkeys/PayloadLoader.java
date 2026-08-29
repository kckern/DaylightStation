package net.kckern.portalkeys;

import android.content.Context;
import dalvik.system.DexClassLoader;
import net.kckern.portalkeys.api.Payload;
import net.kckern.portalkeys.api.ShellServices;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class PayloadLoader {
    private static final String ENTRY = "net.kckern.portalkeys.payload.Main";
    private final Context ctx; private final ShellServices shell; private final PayloadStore store;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Payload active; private volatile String activeName; private volatile String error;
    PayloadLoader(Context c, ShellServices s) { ctx=c; shell=s; store=new PayloadStore(new File(c.getFilesDir(),"payloads")); }
    PayloadStore store(){return store;}
    synchronized void boot() {
        if (store.current()==null) bake();
        if (!load(store.current())) { try { String p=store.rollback(); if(p!=null) load(p); } catch(Exception ignored){} }
    }
    synchronized void stop(){ if(active!=null) try{active.stop();}catch(Throwable ignored){} active=null; }
    String swap(String url,String sha){ if(url==null||sha==null||sha.length()<32)return "refused: url and sha256 required"; worker.submit(()->doSwap(url,sha)); return "accepted"; }
    String rollback(){ if(store.previous()==null)return "refused: no previous"; worker.submit(()->{synchronized(this){stop();try{load(store.rollback());}catch(Exception e){error=e.toString();}}});return "accepted";}
    String restart(){worker.submit(()->{synchronized(this){String c=store.current();stop();load(c);}});return "accepted";}
    private synchronized void doSwap(String url,String sha){
        File part=new File(store.dir(),"incoming.part");
        try{
            HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection(); c.setConnectTimeout(15000);c.setReadTimeout(60000);
            try(InputStream in=c.getInputStream();FileOutputStream out=new FileOutputStream(part)){byte[]b=new byte[65536];int n;while((n=in.read(b))>0)out.write(b,0,n);}finally{c.disconnect();}
            String name="p-"+sha.substring(0,12)+".jar"; store.commit(part,name,sha); stop(); store.activate(name);
            if(!load(name)){String p=store.rollback();load(p);} else shell.note("PAYLOAD","active "+name+" v="+active.version());
        }catch(Exception e){error=e.toString();part.delete();shell.note("PAYLOAD","swap failed "+error);if(active==null)load(store.current());}
    }
    private boolean load(String name){
        if(name==null)return false;
        try{File jar=new File(store.dir(),name),opt=new File(ctx.getCodeCacheDir(),"payload-opt");opt.mkdirs();
            Class<?> c=new DexClassLoader(jar.getAbsolutePath(),opt.getAbsolutePath(),null,ctx.getClassLoader()).loadClass(ENTRY);
            Payload p=(Payload)c.getDeclaredConstructor().newInstance();p.start(shell);active=p;activeName=name;error=null;return true;
        }catch(Throwable t){error=t.toString();active=null;shell.note("PAYLOAD","load failed "+error);return false;}
    }
    private void bake(){try{File f=new File(store.dir(),"p0-baked.jar");try(InputStream in=ctx.getAssets().open("payload-baked.jar");FileOutputStream out=new FileOutputStream(f)){byte[]b=new byte[65536];int n;while((n=in.read(b))>0)out.write(b,0,n);}store.activate(f.getName());}catch(Exception e){error=e.toString();}}
    JSONObject status(){JSONObject o=new JSONObject();try{o.put("ok",true).put("current",store.current()).put("previous",store.previous()).put("active",activeName).put("activeVersion",active==null?JSONObject.NULL:active.version()).put("available",new JSONArray(store.available())).put("lastError",error==null?JSONObject.NULL:error);}catch(Exception ignored){}return o;}
}
