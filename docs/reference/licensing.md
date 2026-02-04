# DaylightStation Licensing

> Source-available. Free for personal use. Licensable for social proof and commercial rights.

**Last Updated:** 2026-02-04

---

## Baseline: Polyform Noncommercial

DaylightStation is released under the [Polyform Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).

**You can:**
- Use it for any personal, noncommercial purpose
- Modify the source code
- Redistribute (noncommercially)
- Bypass nag screens via code modification (if you go through the trouble, you've earned it)

**Reserved rights (require commercial license):**
- Issue licenses or badges — free or paid, with any signing key
- Provide paid installation, consulting, or support services
- Pre-install on commercial hardware (smart hubs, TVs, appliances)

The licensing mechanism is a commercial right, not just the sale of licenses. Forks cannot establish parallel credentialing systems.

---

## Personal Licenses

Personal licenses unlock features and social proof. They do **not** grant additional code rights — all personal users remain bound by Polyform NC regardless of tier.

### Tiers

| Tier | Monthly | Annual | Lifetime | Badge |
|------|---------|--------|----------|-------|
| **Freeloader** | Free | Free | Free | — |
| **Backer** | $1 | $10 | $50 | ✓ |
| **Sponsor** | $3 | $25 | $125 | 🏆 |
| **Patron** | $5 | $50 | $250 | 💎 |
| **Benefactor** | $10 | $100 | $500 | 👑 |
| **Medici** | $50 | $500 | $2,500 | ⭐ |

Lifetime = 5× annual. License never expires.

### What Personal Licenses Unlock

| Feature | Freeloader | Paid Tier |
|---------|------------|-----------|
| Core functionality | ✅ | ✅ |
| Nag screens | Yes | No |
| Social federation | ❌ | ✅ |
| Network badge | ❌ | ✅ (tier-based) |

### What Personal Licenses Do NOT Grant

- Right to issue licenses or badges
- Right to provide paid services
- Right to commercial distribution
- Support or guarantees of any kind

Software is provided as-is. All tiers receive the same (lack of) warranty.

---

## Commercial Licenses

Commercial licenses grant rights that Polyform NC reserves. Unlike personal licenses, these expand what you're legally permitted to do.

### Baseline: No Commercial Rights

Polyform Noncommercial grants zero commercial rights by default. Any commercial use requires a separate license agreement.

### License Types

| License | Grants Right To | Typical Licensee |
|---------|-----------------|------------------|
| **Installer** | Provide paid installation, configuration, or consulting services | IT consultants, smart home integrators, freelancers |
| **Distributor** | Pre-install on commercial hardware or bundle with paid products | Hardware manufacturers, appliance vendors, system builders |
| **Licensing** | Operate a licensing/badge infrastructure for a fork | Would-be competitors (priced to discourage, or refused) |

### Terms

- **Per-contract basis** — no public pricing, terms negotiated individually
- **No implied rights** — a personal license (even Medici) grants zero commercial rights
- **Scope-limited** — an Installer license doesn't grant Distributor rights, and vice versa

### How to Inquire

Contact [TBD] with:
- Your intended commercial use
- Scope (geography, volume, duration)
- Company information

---

## Badge Verification

Personal licenses are enforced socially, not legally. The mechanism is cryptographic badge verification via a repo-linked public key.

### How It Works

1. **License purchase** → Server issues a signed badge certificate
2. **Badge contains:** instance ID, protocol identity, tier, expiration
3. **Local verification:** Codebase has official pubkey burned in; valid badge unlocks features
4. **Network verification:** Social posts include badge; other clients verify against official pubkey

### The Public Key

The official signing key is published in the repository. Only the original author holds the corresponding private key. This is what makes badges unforgeable.

### Local vs Network Status

**Freeloader is a local-only status.** The official build paywalls social publishing — Freeloaders can configure their Nostr keys but cannot post to the network. They're configured but dark.

To publish without paying, you must fork and remove the paywall. At that point, your badge (if any) fails verification against the official pubkey. The network renders you as Knockoff.

| User State | Local UX | Network Status |
|------------|----------|----------------|
| No license, official build | "Freeloader" — social publishing disabled | Dark (not seen) |
| Paid license, official build | Full features | Tier badge |
| No license, forked build | Whatever the fork shows | 👜 Knockoff |

### The Fork Scenario

A forker could:
1. Remove the publishing paywall
2. Replace the burned-in pubkey with their own
3. Issue licenses signed by their own private key
4. Pass local verification — appear "Paid" to themselves

**But on the network:**
- Other users run official code with the official pubkey
- The forker's badge fails verification
- The forker appears as 👜 Knockoff to everyone else

The fork can lie to itself. It cannot lie to the network.

### Network Badge Display

| Situation | Badge |
|-----------|-------|
| Valid badge, active subscription | Tier badge (✓ 🏆 💎 👑 ⭐) |
| Valid badge, lifetime | Tier badge + 🎖️ |
| Valid badge, payment past due | ⚠️ Delinquent |
| Valid badge, subscription cancelled | 🪦 Lapsed |
| Badge fails official pubkey verification | 👜 Knockoff |

### Knockoff Status

Knockoff is the rendered badge when verification fails. Each client independently:
1. Receives the interaction with attached badge
2. Verifies signature against the official pubkey
3. Fails verification → renders 👜 Knockoff

No central authority. No judgment call. Just math.

The Knockoff might be:
- A solo hacker who forked to bypass the paywall (legal — personal use)
- A user of a fork running unauthorized licensing infrastructure (legal for the user, not for the fork operator)
- Someone with a corrupted badge

The client doesn't know and doesn't care. Signature failed. Knockoff badge rendered.

**Issuing licenses is the reserved right, not bypassing local restrictions.** A solo hacker is within their Polyform NC rights. A fork that operates licensing infrastructure is not.

---

## FAQ

### General

**Is DaylightStation open source?**

It's source-available under Polyform Noncommercial. You can view, modify, and redistribute the code for noncommercial purposes. It is not OSI-approved "open source" because commercial use requires a separate license.

**Is it free?**

Free for personal, noncommercial use. Paid licenses unlock social features and remove nag screens. Commercial use requires a commercial license.

### Personal Use

**Can I fork the code?**

Yes. You can fork, modify, and run your own version for personal use.

**Can I remove the nag screens?**

Yes. If you go through the trouble of forking and modifying the code to bypass them, you've earned it. This is within your Polyform NC rights.

**Can I bypass the social paywall?**

Technically yes — by forking. But your badge will fail verification against the official pubkey. The network will render you as 👜 Knockoff. You can participate, but everyone knows.

**What's the difference between Freeloader and Knockoff?**

- **Freeloader:** Local status. Using the official build without paying. Social publishing is disabled — you're configured but dark.
- **Knockoff:** Network status. Publishing via a fork with credentials that fail official verification. You're visible, but marked.

Freeloader is honest non-participation. Knockoff is participation with unofficial credentials.

### Commercial Use

**Can I sell installation or consulting services?**

Not without an Installer license. Providing paid services around DaylightStation is a reserved commercial right.

**Can I pre-install on hardware I sell?**

Not without a Distributor license. Commercial bundling is a reserved right.

**Can I fork and issue my own licenses?**

No. Operating a licensing infrastructure — free or paid — is a reserved commercial right. This is the line between personal hacking (allowed) and commercial activity (requires license).

**How do I get a commercial license?**

Contact [TBD] with your intended use case, scope, and company information. Commercial licenses are negotiated per-contract.

### The Network

**What if I don't care about being marked Knockoff?**

That's your choice. The software works. You can participate. The badge is informational, not a block. Some people wear knockoffs proudly.

**Can I be banned from the network?**

The licensing system doesn't ban anyone. Badge verification is informational. Individual users or relays might block Knockoff badges, but that's their choice, not a platform decision.

**What if the official pubkey changes?**

Badge certificates are signed at issuance. If the pubkey rotates, old badges would fail verification. In practice, key rotation would be announced with a migration path for existing licensees.
