# Audit: Office TV Audio Endpoint Timeout

**Date:** 2026-02-07
**Trigger:** Home Assistant automation `office_morning_program_auto_start` failed at 16:08:33 UTC
**Error:** HTTP timeout calling `http://daylight-station:3111/api/v1/device/office-tv/audio/DisplayPort 1`
**Severity:** High — blocks morning automation entirely (first action in sequence)

---

## Root Cause

**The `office-tv` device registered with `osControl: false` and `audioDevice: false` at boot.**

Production log evidence (07:48:39 UTC boot):
```json
{
  "event": "deviceService.deviceRegistered",
  "data": {
    "deviceId": "office-tv",
    "capabilities": {
      "deviceControl": true,
      "osControl": false,
      "contentControl": false,
      "volume": null,
      "audioDevice": false
    }
  }
}
```

The `osControl` capability failed to build because the `RemoteExecAdapter` was never created.

---

## Failure Chain

```
1. app.mjs:775        configService.getAppConfig('remote_exec') → {} (no config file exists)
2. app.mjs:792-798    remoteExec config built with host: '' (empty string)
3. bootstrap.mjs:1276 Guard `config.remoteExec?.host` → falsy, remoteExecAdapter = null
4. app.mjs:832        createDeviceServices({ remoteExec: null })
5. DeviceFactory.mjs:119-121  #buildOsControl: this.#remoteExec is null → logs "deviceFactory.noRemoteExec"
6. DeviceFactory.mjs returns null osControl → Device has audioDevice: false
7. device.mjs:273     GET /:deviceId/audio/:audioDevice route hit
8. device.mjs:285     device.hasCapability('audioDevice') → false → HTTP 400 returned
```

**However, the production logs show NO request reaching the endpoint at 16:08 UTC.** The HA automation reported a timeout, not a 400 error. This suggests the issue is compounding:

### Issue A: Missing `remote_exec` app config (primary)

No `data/household/config/remote_exec.yml` or equivalent exists in production. The `SshOsAdapter` cannot be created without a functioning `RemoteExecAdapter` as its dependency.

Production confirmation:
```
$ find data/ -name 'remote_exec*' -o -name 'remote-exec*'
(no results)
```

The `RemoteExecAdapter` constructor should receive `host`, `user`, `privateKey` from an app config file, but `getAppConfig('remote_exec')` returns `null`, falling back to `{}`.

### Issue B: Device config has SSH details but they're ignored

`devices.yml` defines `os_control` for `office-tv` with complete SSH config:
```yaml
os_control:
  provider: ssh
  host: 172.17.0.1
  user: kckern
  port: 22
  commands:
    audio_device: "pactl set-default-sink {device}"
```

But the `DeviceFactory` doesn't use these SSH connection details directly. It creates an `SshOsAdapter` with the command templates, but delegates SSH execution to a shared `RemoteExecAdapter` singleton. When that singleton is null, the entire capability chain breaks.

### Issue C: Architecture mismatch between SshOsAdapter and RemoteExecAdapter

`SshOsAdapter.execute()` passes `{host, user, port}` to `remoteExec.execute()`:
```js
const result = await this.#remoteExec.execute(command, {
  host: this.#host, user: this.#user, port: this.#port
});
```

But `RemoteExecAdapter.execute(command)` only accepts one parameter — the host/user/port override is silently dropped. Even if the adapter were created, it would use its own configured host, not the per-device host from `devices.yml`.

### Issue D: URL encoding — space in "DisplayPort 1"

The HA automation URL contains an unencoded space: `/audio/DisplayPort 1`. While Express generally handles URL-decoded params, the raw HTTP request with a space may cause issues depending on the HTTP client. HA should encode this as `/audio/DisplayPort%201`.

### Issue E: No request logged at all

At 16:08:33 UTC, zero requests to any device endpoint appear in logs. Possible explanations:
1. HA's request never reached the container (DNS/network issue with `daylight-station` hostname)
2. The request was lost because of the unencoded space in the URL
3. The request reached Express but the response was slow enough to cause HA-side timeout, and no request logging middleware is active on the device router (it logs at `debug` level only)

---

## Existing Workaround (Legacy Route)

The old `homeAutomation` router at `/api/v1/home/audio/:device` has the same dependency on `remoteExecAdapter`, but returns a clear 503 error:
```js
if (!remoteExecAdapter) {
  return res.status(503).json({
    error: 'Audio device control not configured (Remote exec adapter required)'
  });
}
```

Both old and new routes are broken because the `RemoteExecAdapter` was never created.

---

## Device Config vs App Config Disconnect

The `devices.yml` has everything needed for SSH:
| Field | Value |
|-------|-------|
| `host` | `172.17.0.1` (Docker host gateway) |
| `user` | `kckern` |
| `port` | `22` |
| `commands.audio_device` | `pactl set-default-sink {device}` |

But `RemoteExecAdapter` is configured from a separate app config (`remote_exec`) that doesn't exist. The `SshOsAdapter` has the host/user/port but can't use them because:
1. It depends on a `RemoteExecAdapter` instance for SSH execution
2. The `RemoteExecAdapter` ignores the per-call host/user/port override
3. The `RemoteExecAdapter` needs a `privateKey` path, which is only known at the system level (`/usr/src/app/host_private_key`)

---

## Docker SSH Key Issue

Container startup log shows:
```
chown: host_private_key: Read-only file system
chmod: host_private_key: Read-only file system
```

The SSH private key is mounted read-only (`:ro` in docker-compose). The `entrypoint.sh` tries to `chmod 400` it but fails. SSH clients typically refuse keys with overly permissive file permissions, which could cause command execution failures even if the `RemoteExecAdapter` were properly initialized.

---

## Recommendations

### Fix 1: Create `remote_exec` app config (quick fix)

Create a config file that `getAppConfig('remote_exec')` can find, containing:
```yaml
host: 172.17.0.1
user: kckern
port: 22
private_key: /usr/src/app/host_private_key
known_hosts_path: /usr/src/app/known_hosts
```

This gets the `RemoteExecAdapter` created and the `SshOsAdapter` will at least partially work (using the singleton's connection details).

### Fix 2: Wire device-level SSH config to RemoteExecAdapter (proper fix)

Either:
- **Option A:** Make `RemoteExecAdapter.execute()` accept and honor the `{host, user, port}` override from `SshOsAdapter`, allowing per-device SSH targets
- **Option B:** Create a `RemoteExecAdapter` per device in `DeviceFactory.#buildOsControl()` using the device config's SSH details, rather than sharing a singleton
- **Option C:** Make `DeviceFactory` construct `RemoteExecAdapter` directly from `os_control` config when `provider: ssh`, using the `privateKey` from system config

### Fix 3: URL encode the automation URL

The HA automation should call `/api/v1/device/office-tv/audio/DisplayPort%201` instead of `/audio/DisplayPort 1`.

### Fix 4: Fix SSH key permissions in Docker

Either:
- Copy the key to a writable location in `entrypoint.sh` before chmod
- Set correct permissions on the host before mounting
- Use `StrictHostKeyChecking=no` and ignore permission warnings (already done in `RemoteExecAdapter.#buildSshCommand`)

### Fix 5: Add request-level logging to device router

The device router has no request logging middleware applied, making timeout investigation difficult. Add `requestLoggerMiddleware` to the device router or enable HTTP access logging globally.

---

## Related Code

| File | Role |
|------|------|
| [backend/src/4_api/v1/routers/device.mjs](backend/src/4_api/v1/routers/device.mjs#L270-L295) | Audio endpoint handler |
| [backend/src/3_applications/devices/services/Device.mjs](backend/src/3_applications/devices/services/Device.mjs#L145-L152) | `setAudioDevice()` method |
| [backend/src/3_applications/devices/services/DeviceFactory.mjs](backend/src/3_applications/devices/services/DeviceFactory.mjs#L107-L127) | `#buildOsControl()` — where null is returned |
| [backend/src/1_adapters/devices/SshOsAdapter.mjs](backend/src/1_adapters/devices/SshOsAdapter.mjs) | SSH command delegation |
| [backend/src/1_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs](backend/src/1_adapters/home-automation/remote-exec/RemoteExecAdapter.mjs) | SSH execution (ignores per-call host) |
| [backend/src/0_system/bootstrap.mjs](backend/src/0_system/bootstrap.mjs#L1275-L1288) | RemoteExecAdapter creation guard |
| [backend/src/app.mjs](backend/src/app.mjs#L775) | `getAppConfig('remote_exec')` — returns null |
| [docker/entrypoint.sh](docker/entrypoint.sh) | SSH key chmod failure |
