# Sandboxed `claude` Linux User — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a restricted Linux user `claude` that can run Claude Code autonomously, with writes scoped to `/opt/Code` and `$HOME`, read-only elsewhere, and scoped Docker sudo access.

**Architecture:** Standard Linux user with no docker group membership. Docker access via sudoers allowlist. Code directory moved to `/opt/Code` with shared group ownership. Auto-launches Claude CLI in tmux on SSH login.

**Tech Stack:** Linux user management, sudoers, tmux, nvm, Claude CLI, SSH

**Prerequisites found during exploration:**
- tmux is NOT installed — must install
- Node is via nvm under `/root/.nvm` — claude user needs own nvm install
- Claude CLI is under `/root/.local/` — claude user needs own install
- User `claude` and group `codedev` do not exist yet
- `/opt/Code` does not exist yet

---

### Task 1: Install tmux

**Step 1: Install tmux**

Run:
```bash
apt-get update && apt-get install -y tmux
```

Expected: tmux installs successfully

**Step 2: Verify**

Run:
```bash
tmux -V
```

Expected: `tmux X.Y` version output

---

### Task 2: Create group and user

**Step 1: Create the `codedev` shared group**

Run:
```bash
groupadd codedev
```

**Step 2: Create the `claude` user**

Run:
```bash
useradd -m -s /bin/bash -G codedev claude
```

This creates `/home/claude` with bash shell, adds to `codedev` group.

**Step 3: Add root to `codedev` group**

Run:
```bash
usermod -aG codedev root
```

**Step 4: Verify**

Run:
```bash
id claude
groups root
```

Expected: `claude` is in `claude` and `codedev` groups. `root` is in `codedev`.

---

### Task 3: Move `/root/Code` to `/opt/Code`

**CAUTION:** This moves the working directory. Make sure no processes are using it.

**Step 1: Check nothing is using `/root/Code`**

Run:
```bash
lsof +D /root/Code 2>/dev/null | head -5 || echo "nothing using it"
```

**Step 2: Move the directory**

Run:
```bash
mv /root/Code /opt/Code
```

**Step 3: Set ownership — claude owns, codedev group, setgid for new files**

Run:
```bash
chown -R claude:codedev /opt/Code
chmod 2775 /opt/Code
find /opt/Code -type d -exec chmod 2775 {} \;
find /opt/Code -type f -exec chmod 664 {} \;
```

The setgid bit (`2`) ensures new files inherit the `codedev` group.

**Step 4: Restore execute bits on scripts and git objects**

Run:
```bash
cd /opt/Code/DaylightStation && git checkout -- .
find /opt/Code -name "*.sh" -exec chmod 775 {} \;
find /opt/Code -name ".git" -prune -o -type f -name "*.mjs" -print -exec chmod 664 {} \;
```

Note: `git checkout -- .` restores file modes tracked by git.

**Step 5: Create symlinks**

Run:
```bash
ln -s /opt/Code /root/Code
ln -s /opt/Code /home/claude/Code
```

**Step 6: Verify**

Run:
```bash
ls -la /opt/Code/
ls -la /root/Code
ls -la /home/claude/Code
stat -c '%U:%G %a' /opt/Code
```

Expected: `/opt/Code` owned by `claude:codedev`, mode `2775`. Both symlinks resolve.

---

### Task 4: Configure SSH access

**Step 1: Create `.ssh` directory**

Run:
```bash
mkdir -p /home/claude/.ssh
chmod 700 /home/claude/.ssh
```

**Step 2: Copy authorized key**

Run:
```bash
cp /root/.ssh/authorized_keys /home/claude/.ssh/authorized_keys
```

**Step 3: Copy GitHub SSH key and config**

Run:
```bash
cp /root/.ssh/github_ed25519 /home/claude/.ssh/github_ed25519
cp /root/.ssh/github_ed25519.pub /home/claude/.ssh/github_ed25519.pub
cp /root/.ssh/known_hosts /home/claude/.ssh/known_hosts
```

**Step 4: Write SSH config**

Write `/home/claude/.ssh/config`:
```
Host github.com
    IdentityFile ~/.ssh/github_ed25519
    User git
```

**Step 5: Fix ownership and permissions**

Run:
```bash
chown -R claude:claude /home/claude/.ssh
chmod 700 /home/claude/.ssh
chmod 600 /home/claude/.ssh/github_ed25519
chmod 644 /home/claude/.ssh/github_ed25519.pub
chmod 644 /home/claude/.ssh/config
chmod 600 /home/claude/.ssh/authorized_keys
chmod 644 /home/claude/.ssh/known_hosts
```

**Step 6: Verify SSH works**

Run:
```bash
su - claude -c 'ssh -T git@github.com' 2>&1 | head -3
```

Expected: `Hi kckern! You've successfully authenticated` (or similar)

---

### Task 5: Configure Git

**Step 1: Write gitconfig**

Write `/home/claude/.gitconfig`:
```ini
[user]
    name = Claude (autonomous)
    email = noreply@anthropic.com
[safe]
    directory = /opt/Code/DaylightStation
    directory = /opt/Code/BishopricTools
    directory = /opt/Code/Transcendex
```

**Step 2: Fix ownership**

Run:
```bash
chown claude:claude /home/claude/.gitconfig
```

**Step 3: Verify**

Run:
```bash
su - claude -c 'cd /opt/Code/DaylightStation && git status'
```

Expected: Shows clean status on `main` branch.

---

### Task 6: Configure Docker sudo access

**Step 1: Write sudoers file**

Write `/etc/sudoers.d/claude`:
```
# Docker commands for claude user — scoped access
# Read-only / monitoring (any container)
claude ALL=(root) NOPASSWD: /usr/bin/docker logs *
claude ALL=(root) NOPASSWD: /usr/bin/docker ps *
claude ALL=(root) NOPASSWD: /usr/bin/docker stats *
claude ALL=(root) NOPASSWD: /usr/bin/docker images *
claude ALL=(root) NOPASSWD: /usr/bin/docker inspect *

# Build (any image)
claude ALL=(root) NOPASSWD: /usr/bin/docker build *

# Lifecycle — daylight-station only
claude ALL=(root) NOPASSWD: /usr/bin/docker stop daylight-station
claude ALL=(root) NOPASSWD: /usr/bin/docker rm daylight-station
claude ALL=(root) NOPASSWD: /usr/bin/docker exec daylight-station *

# Deploy wrapper (hardcoded docker run flags)
claude ALL=(root) NOPASSWD: /usr/local/bin/deploy-daylight
```

**Step 2: Set permissions (sudoers files MUST be 0440)**

Run:
```bash
chmod 0440 /etc/sudoers.d/claude
```

**Step 3: Validate sudoers syntax**

Run:
```bash
visudo -cf /etc/sudoers.d/claude
```

Expected: `/etc/sudoers.d/claude: parsed OK`

**Step 4: Verify**

Run:
```bash
su - claude -c 'sudo docker ps'
su - claude -c 'sudo docker logs daylight-station --tail 3'
```

Expected: Both work without password prompt.

---

### Task 7: Create deploy wrapper script

**Step 1: Write the script**

Write `/usr/local/bin/deploy-daylight`:
```bash
#!/bin/bash
set -euo pipefail

CONTAINER="daylight-station"
IMAGE="kckern/daylight-station:latest"
NETWORK="kckern-net"
DATA="/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data"
MEDIA="/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media"

echo "Deploying $CONTAINER from $IMAGE..."

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network "$NETWORK" \
  -p 3111:3111 \
  -v "$DATA:/usr/src/app/data" \
  -v "$MEDIA:/usr/src/app/media" \
  "$IMAGE"

echo "Container $CONTAINER started."
docker ps --filter "name=$CONTAINER" --format "table {{.ID}}\t{{.Status}}\t{{.Ports}}"
```

**Step 2: Set ownership and permissions**

Run:
```bash
chown root:root /usr/local/bin/deploy-daylight
chmod 755 /usr/local/bin/deploy-daylight
```

**Step 3: Verify (dry run — don't actually deploy)**

Run:
```bash
su - claude -c 'which deploy-daylight || echo "not in PATH"'
su - claude -c 'cat /usr/local/bin/deploy-daylight'
```

Expected: Script is readable but not writable by claude.

---

### Task 8: Install Node.js (nvm) for claude user

The `claude` user needs `node`/`npm` for `npm run dev`, `npm run build`, etc.

**Step 1: Install nvm as claude user**

Run:
```bash
su - claude -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
```

**Step 2: Install matching Node version**

Run:
```bash
su - claude -c 'source ~/.nvm/nvm.sh && nvm install 24.13.0 && nvm alias default 24.13.0'
```

**Step 3: Verify**

Run:
```bash
su - claude -c 'source ~/.nvm/nvm.sh && node --version && npm --version'
```

Expected: `v24.13.0` and npm version output.

---

### Task 9: Install Claude CLI for claude user

**Step 1: Install Claude CLI**

Run:
```bash
su - claude -c 'curl -fsSL https://claude.ai/install.sh | sh'
```

**Step 2: Verify installation**

Run:
```bash
su - claude -c '/home/claude/.local/bin/claude --version'
```

Expected: Version output (e.g., `2.1.69`)

**Step 3: Ensure it's in PATH**

Check that `/home/claude/.local/bin` is in claude's PATH (the installer usually adds it to `.bashrc`).

Run:
```bash
su - claude -c 'which claude'
```

Expected: `/home/claude/.local/bin/claude`

---

### Task 10: Configure auto-start with tmux

**Step 1: Write `.bash_profile`**

Write `/home/claude/.bash_profile`:
```bash
# Source .bashrc for nvm, PATH, etc.
if [ -f ~/.bashrc ]; then
    source ~/.bashrc
fi

# Auto-start Claude in tmux on interactive SSH login
if [ -n "$SSH_CONNECTION" ] && [ -z "$TMUX" ]; then
    cd /opt/Code/DaylightStation
    exec tmux new-session -A -s claude \
        'claude --dangerously-skip-permissions'
fi
```

Note: `exec` replaces the shell so logout is clean when tmux exits.

**Step 2: Fix ownership**

Run:
```bash
chown claude:claude /home/claude/.bash_profile
```

---

### Task 11: End-to-end verification

**Step 1: Test SSH login launches tmux + claude**

Run (from root):
```bash
ssh claude@localhost
```

Expected: Drops into tmux session with Claude CLI running in `/opt/Code/DaylightStation`.

Detach with `Ctrl+b d` to exit without killing Claude.

**Step 2: Test Docker access**

From a claude shell:
```bash
sudo docker ps
sudo docker logs daylight-station --tail 5
sudo docker build --help
```

Expected: All work without password.

**Step 3: Test write scoping**

From a claude shell:
```bash
touch /opt/Code/test-write && rm /opt/Code/test-write && echo "Code: OK"
touch /tmp/test-write && rm /tmp/test-write && echo "tmp: OK"
touch /etc/test-write 2>&1 || echo "etc: DENIED (correct)"
touch /root/test-write 2>&1 || echo "root home: DENIED (correct)"
```

Expected: Code and tmp succeed, etc and root denied.

**Step 4: Test git**

From a claude shell:
```bash
cd /opt/Code/DaylightStation
git status
git log --oneline -3
ssh -T git@github.com
```

Expected: All work.

---

### Task 12: Manual post-setup — Claude CLI authentication

**This step requires human interaction.**

Run:
```bash
su - claude
claude login
```

Follow the browser-based auth flow to authenticate. This stores credentials in `/home/claude/.claude/`.

---

### Task 13: Commit the design doc

Run:
```bash
cd /opt/Code/DaylightStation
git add docs/plans/2026-03-05-sandboxed-claude-user-design.md
git add docs/plans/2026-03-05-sandboxed-claude-user-plan.md
git commit -m "docs: sandboxed claude user design and implementation plan"
```
