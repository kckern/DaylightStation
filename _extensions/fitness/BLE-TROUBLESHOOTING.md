# BLE Troubleshooting Guide

## BlueZ Stale GATT Cache (Critical)

**Symptom:** `BleakClient` connects but GATT service discovery hangs (TimeoutError), or `[org.bluez.Error.NotPermitted] Notify acquired`.

**Root cause:** BlueZ caches GATT service data for previously-connected devices. On reconnect, it tries to use the cached services, but the device rejects the stale data and GATT discovery hangs indefinitely.

**Fix:** Clear the device from BlueZ cache before each connection attempt:
```python
subprocess.run(["bluetoothctl", "remove", address], capture_output=True, timeout=5)
```

This is implemented in both `generateMonitorScript()` (jumprope) and `_generateHRScanScript()` (HR devices) via the `clear_bluez_cache()` helper.

**Manual fix:**
```bash
bluetoothctl remove <MAC_ADDRESS>
```

## BLE Adapter Gets Stuck

**Symptom:** Kernel log shows `ACL packet for unknown connection handle`. All BLE connections fail.

**Cause:** Rapid connect/disconnect cycles (e.g., aggressive scan loops) leave orphaned connection handles in the kernel BLE stack.

**Fix:** USB power-cycle the Bluetooth adapter:
```bash
# Find the USB port
lsusb | grep -i bluetooth
# Unbind and rebind (adjust port as needed)
echo "3-3" | sudo tee /sys/bus/usb/drivers/usb/unbind
sleep 3
echo "3-3" | sudo tee /sys/bus/usb/drivers/usb/bind
sleep 3
sudo systemctl restart bluetooth
```

## Multiple BleakScanner Processes

**Symptom:** `find_device_by_address` returns nothing even though `bluetoothctl scan on` sees the device.

**Cause:** Multiple Python processes running `BleakScanner` compete for the BlueZ D-Bus adapter. One scanner blocks the other.

**Fix:** Use `BleakScanner.discover()` instead of `find_device_by_address()`, and match by address in the results. The HR scan also uses a 30-second scan interval (not 10s) to reduce contention.

## Apple Watch / HeartCast HR

HeartCast broadcasts standard BLE HR service (`0x180D`) from the iPhone as a bridge for the Apple Watch. Requirements:

1. HeartCast app on iPhone AND Apple Watch
2. **Start a session on the Watch** — without this, HeartCast shows 0 bpm
3. iPhone acts as BLE bridge; Apple Watch does not broadcast HR directly
4. iPhone rotates its BLE MAC address — the HR scan handles this by spawning new monitor tasks for new addresses

## Renpho R-Q008 Jumprope

- BLE address: configured in `config/ble-devices.json`
- Custom characteristic UUID: `00005303-0000-0041-4c50-574953450000`
- Only advertises when powered on (bluetooth icon flashing on LCD)
- GATT services only discoverable on first connection after power-on if BlueZ cache is stale (see cache fix above)
- Data comes as two alternating packet types (0xAD = jump data, 0xAF = status)

## Docker Container BLE Access

The container uses the host's BlueZ daemon via D-Bus mounts:
- `/run/dbus:/run/dbus:rw`
- `/var/run/dbus:/var/run/dbus:rw`

Required Docker capabilities: `NET_ADMIN`, `NET_RAW`, `SYS_ADMIN`

The container's `bluetoothctl` is a client — the actual `bluetoothd` runs on the host. BlueZ version mismatch between container and host is generally not an issue.

## Verifying BLE Hardware

```bash
# Check adapter
hciconfig hci0

# Scan for devices (from host)
timeout 10 bluetoothctl scan on

# Check RSSI for a specific device
bluetoothctl info <MAC_ADDRESS> | grep RSSI

# Check kernel errors
dmesg | grep -i bluetooth | tail -20
```
