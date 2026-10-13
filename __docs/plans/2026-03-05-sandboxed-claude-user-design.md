# Sandboxed `claude` Linux User — Design

## Goal

Create a restricted Linux user `claude` on `kckern-server` that can run Claude Code autonomously via SSH, with write access scoped to `/opt/Code` and its own home directory, read-only access elsewhere, and scoped Docker commands for the DaylightStation build/deploy/monitor workflow.

## Directory Layout

| Path | Owner | Purpose |
|------|-------|---------|
| `/opt/Code/` | `claude:codedev` | Canonical code directory (moved from `/root/Code`) |
| `/root/Code` | symlink → `/opt/Code` | Backward compat for root |
| `/home/claude/Code` | symlink → `/opt/Code` | Convenience for claude |
| `/home/claude/` | `claude:claude` | Home dir (CLI config, cache, tmux) |

A shared group `codedev` gives both `root` and `claude` write access to `/opt/Code`.

## Permission Model

| Path | Access | Mechanism |
|------|--------|-----------|
| `/opt/Code/` | Read + Write | Ownership (`claude:codedev`), group write |
| `/home/claude/` | Read + Write | Home directory ownership |
| `/media/kckern/*` | Read | Existing world/group-readable perms |
| `/etc`, `/usr`, `/var`, etc. | Read | Default unprivileged user |
| Docker (scoped) | Execute | sudoers allowlist |
| Docker run | Execute | `deploy-daylight` wrapper only |

## Docker Access

No docker group membership. Scoped via `/etc/sudoers.d/claude`:

```
claude ALL=(root) NOPASSWD: /usr/bin/docker build *
claude ALL=(root) NOPASSWD: /usr/bin/docker logs *
claude ALL=(root) NOPASSWD: /usr/bin/docker ps *
claude ALL=(root) NOPASSWD: /usr/bin/docker stats *
claude ALL=(root) NOPASSWD: /usr/bin/docker exec daylight-station *
claude ALL=(root) NOPASSWD: /usr/bin/docker stop daylight-station
claude ALL=(root) NOPASSWD: /usr/bin/docker rm daylight-station
claude ALL=(root) NOPASSWD: /usr/local/bin/deploy-daylight
```

### Deploy Wrapper Script

`/usr/local/bin/deploy-daylight` — owned by `root:root`, mode `755`:

```bash
#!/bin/bash
set -euo pipefail
docker run -d \
  --name daylight-station \
  --restart unless-stopped \
  --network kckern-net \
  -p 3111:3111 \
  -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data:/usr/src/app/data \
  -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media:/usr/src/app/media \
  kckern/daylight-station:latest
```

## Git Configuration

`/home/claude/.gitconfig`:

```ini
[user]
    name = Claude (autonomous)
    email = noreply@anthropic.com
[safe]
    directory = /opt/Code/DaylightStation
```

GitHub SSH key and config copied from root:

- `/root/.ssh/github_ed25519` → `/home/claude/.ssh/github_ed25519`
- `/root/.ssh/github_ed25519.pub` → `/home/claude/.ssh/github_ed25519.pub`
- `/root/.ssh/known_hosts` → `/home/claude/.ssh/known_hosts`

`/home/claude/.ssh/config`:

```
Host github.com
    IdentityFile ~/.ssh/github_ed25519
    User git
```

## SSH Access

Root's authorized key copied to `/home/claude/.ssh/authorized_keys`:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICoZN9g1YsYDZRsBZapW0Z5n3zrEV98VCVQDvJMA68bQ
```

## Auto-Start on Login

`/home/claude/.bash_profile`:

```bash
# Auto-start Claude in tmux on interactive SSH login
if [ -n "$SSH_CONNECTION" ] && [ -z "$TMUX" ]; then
  cd /opt/Code/DaylightStation
  tmux new-session -A -s claude \
    'claude --dangerously-skip-permissions'
fi
```

- `tmux -A -s claude` reattaches to existing session if present
- Observable from another terminal via `tmux attach -t claude`

## Post-Setup Manual Steps

1. `su - claude` → `claude login` to authenticate the CLI
2. Verify Claude works: `claude --dangerously-skip-permissions` in `/opt/Code/DaylightStation`
