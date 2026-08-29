package net.kckern.portalkeys.payload;
import android.content.Context;import android.hardware.input.InputManager;import android.hardware.usb.UsbDevice;import android.hardware.usb.UsbManager;import android.view.InputDevice;import org.json.JSONArray;import org.json.JSONObject;import java.util.Map;
final class InputProbe{
    static JSONObject snapshot(Context c){JSONObject root=new JSONObject();JSONArray inputs=new JSONArray(),usb=new JSONArray();try{
        for(int id:InputDevice.getDeviceIds()){InputDevice d=InputDevice.getDevice(id);if(d==null)continue;inputs.put(new JSONObject().put("id",id).put("name",d.getName()).put("descriptor",d.getDescriptor()).put("vendorId",d.getVendorId()).put("productId",d.getProductId()).put("sources",d.getSources()).put("keyboardType",d.getKeyboardType()).put("external",d.isExternal()).put("virtual",d.isVirtual()));}
        UsbManager m=(UsbManager)c.getSystemService(Context.USB_SERVICE);for(Map.Entry<String,UsbDevice>e:m.getDeviceList().entrySet()){UsbDevice d=e.getValue();usb.put(new JSONObject().put("path",e.getKey()).put("name",d.getDeviceName()).put("vendorId",d.getVendorId()).put("productId",d.getProductId()).put("class",d.getDeviceClass()).put("subclass",d.getDeviceSubclass()).put("protocol",d.getDeviceProtocol()).put("interfaces",d.getInterfaceCount()).put("permission",m.hasPermission(d)));}
        root.put("ok",true).put("inputs",inputs).put("usb",usb);
    }catch(Exception e){try{root.put("ok",false).put("error",e.toString());}catch(Exception ignored){}}return root;}
}
