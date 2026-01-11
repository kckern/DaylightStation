# README Redesign

**Goal:** Create a single README for self-hosted installers and open source contributors.

**Audience:** Self-hosters first (intermediate homelab users), contributors second.

**Decisions:**
- Docker only deployment (pull from DockerHub)
- Categorized feature overview by domain
- Moderate config documentation
- Contributing info in separate CONTRIBUTING.md
- Professional/technical tone

---

## Structure

```
README.md
├── Header (name, tagline, badges)
├── Overview (2-3 sentences)
├── Features (categorized by domain)
├── Quick Start (5 steps, docker-compose)
├── Configuration (required files, key settings, env vars)
├── Architecture (brief + diagram)
├── Contributing (link to CONTRIBUTING.md)
├── License
└── Links
```

## Files to Create

1. `README.md` - Main project readme (~150 lines)
2. `CONTRIBUTING.md` - Development setup and guidelines
