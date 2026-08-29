package net.kckern.portalkeys.payload;

import android.content.Context;
import fi.iki.elonen.NanoHTTPD;
import net.kckern.portalkeys.api.ShellServices;
import org.json.JSONObject;
import java.util.List;import java.util.Map;

final class OpsServer extends NanoHTTPD{
    static final int PORT=8773;private final ShellServices shell;private final Context context;
    private final UsbHidController usbHid;private final BluetoothController bluetooth;
    OpsServer(ShellServices s,UsbHidController usbHid,BluetoothController bluetooth){super(PORT);shell=s;context=(Context)s.context();this.usbHid=usbHid;this.bluetooth=bluetooth;}
    @Override public Response serve(IHTTPSession x){String u=x.getUri();try{
        if(!authorized(x))return json(Response.Status.UNAUTHORIZED,new JSONObject().put("ok",false).put("error","unauthorized"));
        if(u.equals("/")||u.equals("/status"))return json(new JSONObject().put("ok",true).put("payload","p2-bluetooth-usb-hid").put("port",PORT).put("hidPort",HidBridgeServer.PORT).put("shellVersionCode",shell.shellVersionCode()).put("a11yBound",shell.accessibilityService()!=null).put("usbHid",usbHid==null?JSONObject.NULL:usbHid.status()).put("bluetooth",bluetooth==null?JSONObject.NULL:bluetooth.status()));
        if(u.equals("/input"))return json(InputProbe.snapshot(context));
        if(u.equals("/usb-hid"))return json(usbHid==null?new JSONObject().put("ok",false).put("error","USB HID unavailable"):usbHid.inventory());
        if(u.equals("/usb-hid/retry")&&x.getMethod()==Method.POST){if(usbHid==null)return err("USB HID unavailable");usbHid.retry();return json(usbHid.status());}
        if(u.equals("/usb-hid/config")&&x.getMethod()==Method.POST){if(usbHid==null)return err("USB HID unavailable");int vid=numberParam(x,"vid",-1),pid=numberParam(x,"pid",-1);if(vid<0||pid<0||vid>65535||pid>65535)return err("usage: vid=<0..65535> pid=<0..65535>");usbHid.allow(vid,pid);return json(usbHid.status());}
        if(u.equals("/bluetooth"))return json(bluetooth==null?new JSONObject().put("ok",false).put("error","Bluetooth unavailable"):bluetooth.status());
        if(u.equals("/bluetooth/scan")&&x.getMethod()==Method.POST){if(bluetooth==null)return err("Bluetooth unavailable");return json(bluetooth.scan(intParam(x,"ms",15000)));}
        if(u.equals("/bluetooth/bond")&&x.getMethod()==Method.POST){if(bluetooth==null)return err("Bluetooth unavailable");return json(bluetooth.bond(param(x,"address")));}
        if(u.equals("/bluetooth/connect-hid")&&x.getMethod()==Method.POST){if(bluetooth==null)return err("Bluetooth unavailable");return json(bluetooth.connectHid(param(x,"address")));}
        if(u.equals("/exec")){String cmd=param(x,"cmd");if(cmd==null&&x.getMethod()==Method.POST)cmd=body(x);if(cmd==null)return err("missing cmd");shell.note("EXEC",cmd.length()>200?cmd.substring(0,200):cmd);return json(ShellExec.run(cmd,intParam(x,"timeout",10000)));}
        if(u.equals("/logcat")){String tag=param(x,"tag");String cmd="logcat -d -v time -t "+intParam(x,"lines",200)+(tag==null?"":" -s "+tag);return json(ShellExec.run(cmd,8000));}
        if(u.equals("/getsetting"))return json(SettingsOps.get(context,value(param(x,"ns"),"secure"),param(x,"key")));
        if(u.equals("/setsetting"))return json(SettingsOps.put(context,value(param(x,"ns"),"secure"),param(x,"key"),param(x,"value")));
        if(u.equals("/accessibility/enable"))return json(SettingsOps.enableA11y(context));
        if(u.equals("/payload")){if(x.getMethod()==Method.POST)return json(new JSONObject().put("ok",true).put("result",shell.requestPayloadSwap(param(x,"url"),param(x,"sha256"))));return json(new JSONObject(shell.payloadStatusJson()));}
        if(u.equals("/payload/rollback")&&x.getMethod()==Method.POST)return json(new JSONObject().put("ok",true).put("result",shell.requestPayloadRollback()));
        return err("routes: /status /input /usb-hid /bluetooth /exec /logcat /getsetting /setsetting /accessibility/enable /payload");
    }catch(Exception e){return err(e.toString());}}
    private static String param(IHTTPSession x,String k){Map<String,List<String>>p=x.getParameters();List<String>v=p.get(k);return v==null||v.isEmpty()?null:v.get(0);}
    private static int intParam(IHTTPSession x,String k,int d){try{return Integer.parseInt(param(x,k));}catch(Exception e){return d;}}
    private static int numberParam(IHTTPSession x,String k,int d){try{return Integer.decode(param(x,k));}catch(Exception e){return d;}}
    private static String value(String v,String d){return v==null?d:v;}
    private static String body(IHTTPSession x){try{Map<String,String>f=new java.util.HashMap<>();x.parseBody(f);return f.get("postData");}catch(Exception e){return null;}}
    private boolean authorized(IHTTPSession x){String supplied=x.getHeaders().get("x-portal-token");if(supplied==null){String a=x.getHeaders().get("authorization");if(a!=null&&a.startsWith("Bearer "))supplied=a.substring(7);}return shell.adminToken().equals(supplied);}
    private Response err(String s){try{return json(new JSONObject().put("ok",false).put("error",s));}catch(Exception e){return newFixedLengthResponse(s);}}
    private Response json(JSONObject o){return json(Response.Status.OK,o);}
    private Response json(Response.Status s,JSONObject o){Response r=newFixedLengthResponse(s,"application/json",o.toString());r.addHeader("Access-Control-Allow-Origin","*");return r;}
}
