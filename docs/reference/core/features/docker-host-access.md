# Docker Host Access

Enables the container to execute commands on the Docker host machine via SSH.

## Related code

- `docker/docker-compose.yml` - Volume mount configuration
- `docker/entrypoint.sh` - Key permission setup
- `backend/_legacy/routers/exe.mjs` - SSH command execution

## Configuration

The container needs access to a private SSH key to execute commands on the host.

### Volume Mount

In `docker/docker-compose.yml`:

```yaml
volumes:
  - /home/user/.ssh/docker_host_key:/usr/src/app/host_private_key:ro
```

### Host Setup

1. Generate a dedicated key on the host:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/docker_host_key -N ""
   ```

2. Add the public key to authorized_keys:
   ```bash
   cat ~/.ssh/docker_host_key.pub >> ~/.ssh/authorized_keys
   ```

3. Set permissions:
   ```bash
   chmod 400 ~/.ssh/docker_host_key
   ```

### System Config

In `data/system/system.yml`:

```yaml
cmd:
  host: 0.0.0.0 # SSH host (usually localhost)
  port: 22
  user: user
  known_hosts: ./known_hosts
  private_key: /usr/src/app/host_private_key
```

## Features Enabled

With host access configured, the following work:

- **Audio switching** - Change audio output device (`wpctl set-default`)
- **Volume control** - Adjust system volume (`amixer set Master`)
- **Display control** - HDMI switching via Home Assistant scripts

## Troubleshooting

### "Identity file not accessible"

The SSH key isn't mounted. Check:
- Volume mount exists in docker-compose.yml
- Key file exists on host at the specified path
- Key has correct permissions (400 or 600)

### "Permission denied (publickey)"

The public key isn't authorized. Check:
- Public key is in host's `~/.ssh/authorized_keys`
- Key ownership matches the SSH user

### "Read-only file system" warnings at startup

Expected behavior when key is mounted with `:ro`. The entrypoint tries to `chown`/`chmod` but this is non-fatal - the key is already readable.
