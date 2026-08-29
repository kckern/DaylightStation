package net.kckern.portalkeys;

import fi.iki.elonen.NanoHTTPD;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;import java.util.Map;

final class ShellServer extends NanoHTTPD{
    static final int PORT=8772;private final PortalBridgeService service;
    ShellServer(PortalBridgeService s){super(PORT);service=s;}
    @Override public Response serve(IHTTPSession x){try{String u=x.getUri();PayloadLoader l=service.loader();
        if(!authorized(x))return json(Response.Status.UNAUTHORIZED,new JSONObject().put("ok",false).put("error","unauthorized"));
        if(u.equals("/")||u.equals("/status"))return json(new JSONObject().put("ok",true).put("shell",true).put("versionCode",service.versionCode()).put("a11yBound",PortalKeysService.current()!=null).put("payload",l==null?JSONObject.NULL:l.status()));
        if(u.equals("/payload")){if(l==null)return err("loader not ready");if(x.getMethod()==Method.POST){Map<String,List<String>>p=x.getParameters();return json(new JSONObject().put("ok",true).put("result",l.swap(first(p,"url"),first(p,"sha256"))));}return json(l.status());}
        if(u.equals("/payload/rollback")&&x.getMethod()==Method.POST)return json(new JSONObject().put("ok",true).put("result",l.rollback()));
        if(u.equals("/restart")&&x.getMethod()==Method.POST)return json(new JSONObject().put("ok",true).put("result",l.restart()));
        if(u.equals("/log")){String s=new String(Files.readAllBytes(ShellLog.file().toPath()),StandardCharsets.UTF_8);return newFixedLengthResponse(s);}
        return err("routes: /status /payload /payload/rollback /restart /log");
    }catch(Exception e){return err(e.toString());}}
    private static String first(Map<String,List<String>>p,String k){List<String>v=p.get(k);return v==null||v.isEmpty()?null:v.get(0);}
    private boolean authorized(IHTTPSession x){String supplied=x.getHeaders().get("x-portal-token");if(supplied==null){String a=x.getHeaders().get("authorization");if(a!=null&&a.startsWith("Bearer "))supplied=a.substring(7);}return AdminToken.get(service).equals(supplied);}
    private Response err(String s){try{return json(new JSONObject().put("ok",false).put("error",s));}catch(Exception e){return newFixedLengthResponse(s);}}
    private Response json(JSONObject o){return json(Response.Status.OK,o);}
    private Response json(Response.Status s,JSONObject o){Response r=newFixedLengthResponse(s,"application/json",o.toString());r.addHeader("Access-Control-Allow-Origin","*");return r;}
}
