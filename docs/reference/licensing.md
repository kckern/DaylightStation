# DaylightStation Licensing

> MIT licensed. Voluntary supporter program with cryptographic verification.

**Last Updated:** 2026-02-04

---

## License: MIT

DaylightStation is released under the [MIT License](https://opensource.org/licenses/MIT).

**You can:**
- Use it for any purpose, personal or commercial
- Modify the source code
- Redistribute, with or without modifications
- Sell it, bundle it, pre-install it on hardware
- Fork it and call it something else

**You cannot:**
- Remove the copyright notice
- Hold the author liable

That's it. No restrictions on commercial use. No "source-available" asterisks. Pure open source.

---

## Why MIT?

We considered restrictive licenses (Polyform NC, AGPL, dual-licensing) but chose MIT because:

1. **No friction.** The self-hosted community rightly scrutinizes non-OSI licenses. MIT removes that barrier.

2. **Contributions flow freely.** Restrictive licenses discourage corporate contributions and integrations.

3. **Trust is earned, not enforced.** If someone wants to fork, they will. Legal restrictions just add friction for legitimate users.

4. **Social proof works better.** Cryptographic verification of supporter status is more meaningful than legal coercion.

### Risks We Accept

**Forks could gain traction.** Someone could fork DaylightStation, rebrand it, and build a community around it. If they do it better, they deserve to win.

**Commercial OEMs ship free.** A hardware vendor could pre-install DaylightStation on smart home devices without paying anything. We can't stop them, and we won't try.

**No legal leverage.** We can't sue anyone for commercial use, competitive forks, or anything else beyond the bare MIT requirements.

We're betting that the value of being the canonical source — with verified supporters, active development, and community trust — outweighs the protection of restrictive licensing.

---

## Supporter Program

Supporting DaylightStation is voluntary. It unlocks social features and funds development.

### Tiers

| Tier | Monthly | Annual | Lifetime | Badge |
|------|---------|--------|----------|-------|
| **Community** | Free | Free | Free | — |
| **Backer** | $1 | $10 | $50 | ✓ |
| **Sponsor** | $3 | $25 | $125 | bronze |
| **Patron** | $5 | $50 | $250 | silver |
| **Benefactor** | $10 | $100 | $500 | gold |
| **Medici** | $50 | $500 | $2,500 | platinum |

Lifetime = 5x annual. License token never expires.

### What Supporters Get

| Feature | Community | Supporter |
|---------|-----------|-----------|
| Full software functionality | Yes | Yes |
| Verified badge in UI | No | Yes |
| Listed on supporters page | No | Yes |
| Supporters Discord channel | No | Yes |
| Network badge (social features) | No | Yes |
| Warm feeling of contribution | Maybe | Definitely |

### What Supporters Don't Get

- Priority support (there is no support)
- Extra features (all features are available to everyone)
- Legal rights (MIT already grants everything)
- Guarantees of any kind

The supporter program is about community belonging and funding development, not unlocking functionality.

---

## Cryptographic Verification

Supporter status is verified cryptographically, not legally. The mechanism is a signed license token verified against a public key embedded in the codebase.

### How It Works

```
1. User subscribes to supporter program
2. Server generates license token:
   {
     "user_id": "abc123",
     "email": "alice@example.com",
     "tier": "patron",
     "issued": "2026-02-04T00:00:00Z",
     "expires": "2027-02-04T00:00:00Z"
   }
3. Server signs token with private key
4. User adds token to their config (secrets.yml)
5. Software verifies signature against embedded public key
6. Valid signature + not expired = badge displays
```

### The Public Key

The official signing key is published in the repository at `keys/license-verification.pub`. Only the project maintainer holds the corresponding private key.

This means:
- Only the official project can issue valid license tokens
- Tokens are verifiable offline (no phone-home required)
- Forks cannot forge official supporter status

### Verification Is Informational

Verification doesn't gate functionality. An invalid or missing token means:
- Software works identically
- Badge doesn't display
- Network posts show as "unverified"

That's it. No nag screens. No disabled features. No punishment.

---

## Network Verification

For social/federation features, supporter badges are attached to posts and verified by other clients.

### How Network Verification Works

1. User publishes content with attached license token
2. Receiving client extracts token from post
3. Client verifies signature against embedded public key
4. Valid = tier badge displayed; Invalid = "unverified" displayed

Each client independently verifies. No central authority. No trust required.

### Network Badge Display

| Situation | Display |
|-----------|---------|
| Valid token, active subscription | Tier badge |
| Valid token, lifetime | Tier badge |
| Valid token, expired | "expired" indicator |
| Invalid signature | "unverified" |
| No token attached | "unverified" |

### Unverified Status

"Unverified" is not a judgment. It simply means the signature didn't match the official public key. The user might be:

- Running a fork (totally fine under MIT)
- Choosing not to pay (totally fine)
- Having a configuration issue
- Using a build with a different public key

The software doesn't know and doesn't care. Signature valid or not. That's all.

---

## Fork Scenarios

MIT means anyone can fork. Here's how verification interacts with forks:

### Scenario: Personal Fork

User forks DaylightStation, modifies it, runs it at home.

- **License status:** Fully permitted under MIT
- **Supporter badge:** Won't verify (no valid token for fork)
- **Network status:** "unverified" if they post
- **Our stance:** This is fine. Enjoy.

### Scenario: Community Fork

Someone forks DaylightStation, rebrands it, builds a community.

- **License status:** Fully permitted under MIT
- **Their supporter program:** They can create their own with their own keys
- **Cross-verification:** Their badges won't verify on our network, ours won't verify on theirs
- **Our stance:** Competition is healthy. May the best project win.

### Scenario: Commercial OEM

Hardware vendor ships DaylightStation pre-installed on devices.

- **License status:** Fully permitted under MIT
- **Payment to us:** None required
- **Supporter status:** Their users are "unverified" unless they subscribe
- **Our stance:** We'd prefer a partnership, but we can't and won't enforce it.

### Scenario: Hostile Fork

Someone forks with intent to "take over" the project.

- **License status:** Fully permitted under MIT
- **What they get:** The code as of fork date
- **What they don't get:** Our private key, our contributors, our community trust
- **Our stance:** If they out-execute us, they deserve to win.

---

## Trademark

"DaylightStation" and the Daylight Station logo are trademarks. The MIT license grants rights to the code, not the name or branding.

Forks should use a different name. This is standard practice (e.g., Firefox vs. Iceweasel, Chrome vs. Chromium).

---

## FAQ

### General

**Is DaylightStation open source?**

Yes. MIT is an OSI-approved open source license. No asterisks.

**Is it free?**

Yes. Free as in freedom, free as in beer. The supporter program is voluntary.

**What's the catch?**

No catch. We're betting that goodwill, community trust, and voluntary support will sustain the project better than legal restrictions.

### Using DaylightStation

**Can I use it commercially?**

Yes. No restrictions.

**Can I sell services around it?**

Yes. Installation, consulting, support, hosting — all permitted.

**Can I pre-install it on hardware I sell?**

Yes. No distributor license required.

**Can I fork it?**

Yes. Please change the name if you distribute your fork.

### Supporter Program

**What if I don't want to pay?**

Use it for free. All features work. You just won't have a verified badge.

**What if I'm running a fork?**

Your fork can have its own supporter program with its own keys. Your badges won't verify against our public key, and that's fine.

**Can I be banned?**

No. There's no mechanism to ban users. Verification is informational, not gatekeeping.

**What if I lose my license token?**

Log into the supporter portal to regenerate it.

### Technical

**Does it phone home?**

Verification is offline by default. The public key is embedded in the code. Optional online features (supporters page, update notifications) require network access.

**What if the public key changes?**

Key rotation would be announced with a migration path. Existing tokens would continue to work against the old key for a transition period.

**Can I verify badges in my own code?**

Yes. The public key is published. Verification is standard Ed25519 signature checking.

---

## Summary

| Aspect | Approach |
|--------|----------|
| License | MIT — use it however you want |
| Supporter program | Voluntary, funds development |
| Verification | Cryptographic, offline-capable |
| Commercial use | Unrestricted |
| Forks | Permitted, can't forge our badges |
| Enforcement | Social proof, not legal action |

We're building in the open, funded by people who want to see it succeed. That's the deal.
