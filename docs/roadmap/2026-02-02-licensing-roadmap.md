# DaylightStation Licensing Roadmap

Cryptographic licensing with Nostr identity verification for open source software.

## Overview

DaylightStation uses a dual-credential system:
- **License** (private): Full purchase details, kept secret by user
- **Badge Certificate** (public): Minimal proof attached to network events

```
┌─────────────────────────────────────────────────────────────┐
│  Purchase Flow                                              │
│                                                             │
│  User pays → Lambda signs → User receives:                  │
│                                                             │
│  1. License (private)     2. Badge Certificate (public)     │
│     { name, email,           { npub, tier, issued }         │
│       npub, tier }           + YOUR signature               │
│     + YOUR signature                                        │
│                                                             │
│  User keeps #1 secret, attaches #2 to network events        │
└─────────────────────────────────────────────────────────────┘
```

---

## Tiers & Pricing

### Subscription vs Lifetime

| Tier | Monthly | Annual | Lifetime | Badge |
|------|---------|--------|----------|-------|
| **Freeloader** | Free | Free | Free | - |
| **Backer** | $1 | $10 | $50 | ✓ |
| **Sponsor** | $3 | $25 | $125 | 🏆 |
| **Patron** | $5 | $50 | $250 | 💎 |
| **Benefactor** | $10 | $100 | $500 | 👑 |
| **Medici** | $50 | $500 | $2500 | ⭐ |

**Lifetime** = 5x annual price. License never expires, no renewal needed.

### Annual vs Monthly Savings

| Tier | Monthly×12 | Annual | You Save |
|------|------------|--------|----------|
| Backer | $12 | $10 | $2 (17%) |
| Sponsor | $36 | $25 | $11 (31%) |
| Patron | $60 | $50 | $10 (17%) |
| Benefactor | $120 | $100 | $20 (17%) |
| Medici | $600 | $500 | $100 (17%) |

### Tier Descriptions

**Freeloader**: Free unlimited trial. Full core functionality, no social features. Officially chided for not paying.

**Backer**: Entry-level supporter. Unlocks local extras. Add npub anytime for social features.

**Sponsor**: Committed supporter. Same features as Backer, higher status on network.

**Patron**: Classic arts supporter tier. You're keeping the lights on.

**Benefactor**: Serious contributor. People notice your badge.

**Medici**: You're literally funding the Renaissance. Maximum clout.

### Payment Status Badges

Active subscribers show their tier badge. Lapsed subscribers get shamed:

| Payment Status | Network Badge | Description |
|----------------|---------------|-------------|
| Active | Tier badge (✓ 🏆 💎 👑 ⭐) | Currently paid up |
| Past Due | ⚠️ Delinquent | Payment failed, grace period |
| Cancelled | 🪦 Lapsed | Subscription ended |
| Lifetime | Tier badge + 🎖️ | Paid forever |
| Never paid | 🚨 Intruder | Hacked build |

### Feature Access

All paid tiers unlock the same features. The difference is **social proof**.

| Feature | Freeloader | Paid (no npub) | Paid (with npub) |
|---------|------------|----------------|------------------|
| Core app | ✅ | ✅ | ✅ |
| Local extras | ❌ | ✅ | ✅ |
| Social features | ❌ | ❌ | ✅ |
| Network badge | ❌ | ❌ | ✅ (status-based) |

---

## Capability Matrix

| Build | License | npub | Payment Status | Social | Network Badge |
|-------|---------|------|----------------|--------|---------------|
| Official | None | - | - | ❌ | - |
| Official | Any tier | ❌ | Active | ❌ | - |
| Official | Any tier | ✅ | Active | ✅ | Tier badge |
| Official | Any tier | ✅ | Past Due | ✅ | ⚠️ Delinquent |
| Official | Any tier | ✅ | Lapsed | ❌ | 🪦 Lapsed |
| Official | Lifetime | ✅ | N/A | ✅ | Tier badge + 🎖️ |
| Hacked | None | self | - | ✅ | 🚨 Intruder |
| Hacked | Any tier | ✅ | Active | ✅ | Tier badge |

**Key insight**: Official build enforces license checks. Payment status is verified via Stripe on each badge refresh. Hacked builds can bypass local checks, but cannot forge your signature—so they're marked "🚨 Intruder" on the network.

---

## Credential Structures

### License (Private, Permanent)

License is **permanent proof of purchase**. Never expires. Used for app activation and badge refresh.

```json
{
  "product": "daylightstation",
  "version": "1.x",
  "tier": "patron",
  "billing": "subscription",
  "licensed_to": "Kevin Kern",
  "email": "kc@kckern.net",
  "npub": "npub1kckern...",
  "stripe_customer_id": "cus_abc123",
  "issued": 1738483200,
  "nonce": "a1b2c3d4"
}
```
+ YOUR Schnorr signature

**Billing types:**
- `"subscription"` - Monthly or annual, checked against Stripe
- `"lifetime"` - One-time purchase, never expires

### Badge Certificate (Public, Short-Lived)

Badge reflects **current payment status**. Refreshed automatically. Expires after 30 days.

```json
{
  "npub": "npub1kckern...",
  "tier": "patron",
  "status": "active",
  "lifetime": false,
  "valid_until": 1741075200
}
```
+ YOUR Schnorr signature

**Status values:**
- `"active"` - Subscription current, show tier badge
- `"past_due"` - Payment failed, show ⚠️ Delinquent
- `"lapsed"` - Subscription cancelled, show 🪦 Lapsed
- `"lifetime"` - Paid forever, show tier badge + 🎖️

### Badge Refresh Flow

App automatically refreshes badge before expiration:

```
┌─────────────────────────────────────────────────────────────┐
│  App startup / badge nearing expiration                     │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  POST /api/refresh-badge                                    │
│  Body: { license: "..." }                                   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Lambda:                                                    │
│  1. Verify license signature                                │
│  2. Check Stripe subscription status                        │
│  3. Return fresh badge cert (valid 30 days)                 │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  App stores new badge, attaches to future events            │
└─────────────────────────────────────────────────────────────┘
```

### Status Determination Logic

```javascript
async function determineBadgeStatus(license) {
  // Lifetime licenses are always active
  if (license.billing === "lifetime") {
    return { status: "active", lifetime: true };
  }

  // Check Stripe for subscription status
  const subscriptions = await stripe.subscriptions.list({
    customer: license.stripe_customer_id,
    status: "all",
    limit: 1
  });

  const sub = subscriptions.data[0];

  if (!sub) {
    return { status: "lapsed", lifetime: false };
  }

  switch (sub.status) {
    case "active":
    case "trialing":
      return { status: "active", lifetime: false };
    case "past_due":
      return { status: "past_due", lifetime: false };
    case "canceled":
    case "unpaid":
      return { status: "lapsed", lifetime: false };
    default:
      return { status: "lapsed", lifetime: false };
  }
}
```

---

## Purchase Flows

### Flow 1: Purchase as Supporter (no npub)

```
┌─────────────────────────────────────────────────────────────┐
│  Checkout (daylightstation.com)                             │
│                                                             │
│  Name: [Kevin Kern]                                         │
│  Email: [kc@kckern.net]                                     │
│                                                             │
│  ☐ Add Nostr identity for social features (optional)        │
│                                                             │
│  [Pay $X]                                                   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
     Stripe webhook → Lambda → Secrets Manager
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Issued credentials:                                        │
│                                                             │
│  License: { tier: "supporter", npub: null, ... } + sig      │
│  Badge: None (no npub = no social = no badge needed)        │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
     Email with license key
```

### Flow 2: Purchase as Verified (with npub)

```
┌─────────────────────────────────────────────────────────────┐
│  Checkout (daylightstation.com)                             │
│                                                             │
│  Name: [Kevin Kern]                                         │
│  Email: [kc@kckern.net]                                     │
│                                                             │
│  ☑ Add Nostr identity for social features                   │
│    npub: [npub1kckern...]                                   │
│                                                             │
│  [Pay $X]                                                   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Issued credentials:                                        │
│                                                             │
│  License: { tier: "verified", npub: "npub1kckern", ... }    │
│  Badge: { npub: "npub1kckern", tier: "verified", ... }      │
│  Both signed with YOUR key                                  │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
     Email with license key + badge certificate
```

### Flow 3: Free Upgrade (Supporter → Verified)

```
┌─────────────────────────────────────────────────────────────┐
│  Add Identity (daylightstation.com/upgrade)                 │
│                                                             │
│  Already a Supporter? Add your Nostr identity for free.     │
│                                                             │
│  Current license key:                                       │
│  [paste existing license]                                   │
│                                                             │
│  Your npub:                                                 │
│  [npub1...] or [Connect with Alby]                          │
│                                                             │
│  [Upgrade for Free]                                         │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│  Lambda validates:                                          │
│  1. Old license has valid signature (YOUR key)              │
│  2. npub format is valid                                    │
│  3. Optionally: prove npub ownership via challenge          │
│                                                             │
│  Issues new credentials:                                    │
│  License: { tier: "verified", npub: "...", upgraded: now }  │
│  Badge: { npub: "...", tier: "verified", issued: now }      │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
     Display new credentials (+ email copy)
```

### Flow 4: Change npub

Same as Flow 3, but:
- Validates existing license
- Issues new credentials with new npub
- Old badge certificate becomes invalid (npub mismatch)

```
┌─────────────────────────────────────────────────────────────┐
│  Change Identity (daylightstation.com/upgrade)              │
│                                                             │
│  Current license: [paste]                                   │
│  Current identity: npub1old...                              │
│                                                             │
│  New npub: [npub1new...]                                    │
│                                                             │
│  ⚠️ Your old identity will lose its verified badge.         │
│                                                             │
│  [Change Identity]                                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Subscription Lifecycle

### Stripe Products Setup

```javascript
// Create products in Stripe
const products = {
  backer: {
    monthly: "price_backer_monthly",     // $1/mo
    annual: "price_backer_annual",       // $10/yr
    lifetime: "price_backer_lifetime"    // $50 once
  },
  sponsor: {
    monthly: "price_sponsor_monthly",    // $3/mo
    annual: "price_sponsor_annual",      // $25/yr
    lifetime: "price_sponsor_lifetime"   // $125 once
  },
  patron: {
    monthly: "price_patron_monthly",     // $5/mo
    annual: "price_patron_annual",       // $50/yr
    lifetime: "price_patron_lifetime"    // $250 once
  },
  benefactor: {
    monthly: "price_benefactor_monthly", // $10/mo
    annual: "price_benefactor_annual",   // $100/yr
    lifetime: "price_benefactor_lifetime"// $500 once
  },
  medici: {
    monthly: "price_medici_monthly",     // $50/mo
    annual: "price_medici_annual",       // $500/yr
    lifetime: "price_medici_lifetime"    // $2500 once
  }
};
```

### Lifecycle Events

```
┌─────────────────────────────────────────────────────────────┐
│  PURCHASE                                                   │
│  User buys subscription or lifetime                         │
│  → Stripe webhook: checkout.session.completed               │
│  → Issue license + badge cert                               │
│  → Badge status: "active"                                   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼ (subscription renews automatically)
┌─────────────────────────────────────────────────────────────┐
│  RENEWAL SUCCESS                                            │
│  Stripe auto-charges, payment succeeds                      │
│  → Stripe webhook: invoice.paid                             │
│  → No action needed (badge refresh will show active)        │
│  → Badge status: "active"                                   │
└─────────────────────────────────────────────────────────────┘
          │
          ▼ (or payment fails)
┌─────────────────────────────────────────────────────────────┐
│  PAYMENT FAILED                                             │
│  Card declined, expired, etc.                               │
│  → Stripe webhook: invoice.payment_failed                   │
│  → Stripe retries per your settings                         │
│  → Badge status: "past_due" (⚠️ Delinquent)                 │
└─────────────────────────────────────────────────────────────┘
          │
          ▼ (user fixes payment or...)
┌─────────────────────────────────────────────────────────────┐
│  SUBSCRIPTION CANCELLED                                     │
│  All retries failed, or user cancels                        │
│  → Stripe webhook: customer.subscription.deleted            │
│  → Badge status: "lapsed" (🪦 Lapsed)                       │
│  → License still valid (can resubscribe anytime)            │
└─────────────────────────────────────────────────────────────┘
          │
          ▼ (user resubscribes)
┌─────────────────────────────────────────────────────────────┐
│  RESUBSCRIBE                                                │
│  User purchases again with existing license                 │
│  → Stripe creates new subscription                          │
│  → Badge status: "active" (back to tier badge)              │
└─────────────────────────────────────────────────────────────┘
```

### Webhook Handler

```javascript
// Stripe webhook handler
exports.handler = async (event) => {
  const stripeEvent = verifyStripeWebhook(event);

  switch (stripeEvent.type) {
    case "checkout.session.completed":
      await handleNewPurchase(stripeEvent.data.object);
      break;

    case "invoice.paid":
      // Subscription renewed successfully - no action needed
      // Badge refresh will pick up active status
      console.log("Subscription renewed:", stripeEvent.data.object.customer);
      break;

    case "invoice.payment_failed":
      // Optional: Send email warning about payment issue
      await sendPaymentFailedEmail(stripeEvent.data.object.customer_email);
      break;

    case "customer.subscription.deleted":
      // Optional: Send win-back email
      await sendSubscriptionEndedEmail(stripeEvent.data.object);
      break;
  }

  return { statusCode: 200, body: "OK" };
};
```

### Badge Refresh Endpoint

```javascript
// POST /api/refresh-badge
exports.handler = async (event) => {
  const { license } = JSON.parse(event.body);

  // Verify license signature
  const licenseData = verifyAndDecode(license, YOUR_PUBKEY);
  if (!licenseData.valid) {
    return { statusCode: 400, body: "Invalid license" };
  }

  // Determine current status
  const { status, lifetime } = await determineBadgeStatus(licenseData);

  // Build fresh badge cert
  const badge = {
    npub: licenseData.npub,
    tier: licenseData.tier,
    status: status,
    lifetime: lifetime,
    valid_until: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60)
  };

  const badgeCert = signData(badge);

  return {
    statusCode: 200,
    body: JSON.stringify({ badge: badgeCert, status })
  };
};
```

### App-Side Badge Management

```python
BADGE_REFRESH_THRESHOLD = 7 * 24 * 60 * 60  # Refresh if < 7 days remaining

def ensure_fresh_badge():
    """Check badge freshness and refresh if needed."""
    badge = load_badge_certificate()

    if not badge:
        return None

    result = verify_credential(badge)
    if not result["valid"]:
        return None

    # Check if refresh needed
    now = int(time.time())
    valid_until = result.get("valid_until", 0)
    time_remaining = valid_until - now

    if time_remaining < BADGE_REFRESH_THRESHOLD:
        # Refresh from server
        try:
            license = load_license()
            response = requests.post(
                "https://api.daylightstation.com/refresh-badge",
                json={"license": license}
            )
            if response.ok:
                new_badge = response.json()["badge"]
                save_badge_certificate(new_badge)
                return new_badge
        except:
            pass  # Use existing badge if refresh fails

    return badge
```

### Tier Changes During Subscription

Users can upgrade/downgrade anytime:

```
┌─────────────────────────────────────────────────────────────┐
│  Manage Subscription (daylightstation.com/account)         │
│                                                             │
│  Current: Patron ($5/mo)                                    │
│  Status: Active ✓                                           │
│  Next billing: March 15, 2027                               │
│                                                             │
│  Change tier:                                               │
│  ○ Backer ($1/mo) - Downgrade                              │
│  ○ Sponsor ($3/mo) - Downgrade                             │
│  ● Patron ($5/mo) - Current                                │
│  ○ Benefactor ($10/mo) - Upgrade                           │
│  ○ Medici ($50/mo) - Upgrade                               │
│                                                             │
│  Or: [Switch to Annual] [Buy Lifetime]                      │
│                                                             │
│  [Update Subscription]   [Cancel Subscription]              │
└─────────────────────────────────────────────────────────────┘
```

**Stripe handles proration automatically** for subscription changes.

After tier change:
1. Stripe updates subscription
2. Next badge refresh picks up new tier
3. License needs reissue with new tier (or just trust badge for display)

---

### Flow 5: Renewal

Users can renew before or after expiration.

```
┌─────────────────────────────────────────────────────────────┐
│  Renew License (daylightstation.com/renew)                  │
│                                                             │
│  Current license: [paste]                                   │
│                                                             │
│  Current tier: Patron ($50/yr)                              │
│  Expires: March 15, 2027 (in 45 days)                       │
│                                                             │
│  ○ Renew as Patron ($50)                                    │
│  ○ Upgrade to Benefactor ($100) - pay $100                  │
│  ○ Upgrade to Medici ($500) - pay $500                      │
│                                                             │
│  [Renew]                                                    │
└─────────────────────────────────────────────────────────────┘
```

**Renewal logic:**
- If renewed before expiration: new `expires` = old `expires` + 1 year
- If renewed after expiration: new `expires` = now + 1 year
- Upgrade at renewal: pay full price of new tier (no proration)

```javascript
// Lambda renewal logic
const oldExpires = oldData.expires;
const now = Math.floor(Date.now() / 1000);
const oneYear = 365 * 24 * 60 * 60;

// Stack time if renewing early, otherwise start fresh
const newExpires = (oldExpires > now)
  ? oldExpires + oneYear   // Add year to existing expiration
  : now + oneYear;         // Start fresh from today

const newLicense = {
  ...oldData,
  tier: newTier,
  expires: newExpires,
  renewed: now,
  previous_nonce: oldData.nonce,
  nonce: crypto.randomBytes(8).toString('hex')
};
```

### Flow 6: Tier Upgrade (Prorated)

Mid-cycle upgrades are prorated based on time remaining.

```
┌─────────────────────────────────────────────────────────────┐
│  Upgrade Tier (daylightstation.com/upgrade)                 │
│                                                             │
│  Current license: [paste]                                   │
│                                                             │
│  Current tier: Sponsor ($25/yr)                             │
│  Expires: March 15, 2027 (182 days remaining)               │
│                                                             │
│  Upgrade to:                                                │
│  ○ Patron ($50/yr)     → Pay $12.50 (prorated)              │
│  ○ Benefactor ($100/yr)→ Pay $37.50 (prorated)              │
│  ○ Medici ($500/yr)    → Pay $237.50 (prorated)             │
│                                                             │
│  Your expiration date stays the same.                       │
│                                                             │
│  [Pay & Upgrade]                                            │
└─────────────────────────────────────────────────────────────┘
```

**Proration logic:**

```javascript
const TIER_PRICES = {
  'backer': 10,
  'sponsor': 25,
  'patron': 50,
  'benefactor': 100,
  'medici': 500
};

function calculateProration(oldTier, newTier, expiresAt) {
  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  const daysRemaining = Math.max(0, (expiresAt - now) / (24 * 60 * 60));
  const fractionRemaining = daysRemaining / 365;

  const oldPrice = TIER_PRICES[oldTier];
  const newPrice = TIER_PRICES[newTier];
  const priceDiff = newPrice - oldPrice;

  // Prorate the difference
  return Math.round(priceDiff * fractionRemaining * 100) / 100;
}
```

---

## AWS Infrastructure

### Architecture

```
Stripe ──▶ API Gateway ──▶ Lambda ──▶ Secrets Manager
                             │              │
                             │       ┌──────┘
                             ▼       ▼
                        [Signs credentials]
                             │
                             ▼
                      Returns to user
```

### Secrets Manager Setup

```bash
aws secretsmanager create-secret \
  --name "daylightstation/licensing-nsec" \
  --description "Nostr private key for signing licenses" \
  --secret-string "nsec1..."
```

### IAM Policy (Least Privilege)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:daylightstation/licensing-nsec-*"
    }
  ]
}
```

### Lambda Function

```javascript
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { schnorr } = require('@noble/curves/secp256k1');
const { sha256 } = require('@noble/hashes/sha256');
const crypto = require('crypto');

const secretsClient = new SecretsManagerClient({ region: "us-east-1" });
let cachedPrivkey = null;

async function getPrivateKey() {
  if (!cachedPrivkey) {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: "daylightstation/licensing-nsec" })
    );
    cachedPrivkey = nsecToHex(response.SecretString);
  }
  return cachedPrivkey;
}

function signData(data) {
  const dataJson = JSON.stringify(data, Object.keys(data).sort());
  const dataB64 = Buffer.from(dataJson).toString('base64');
  const messageHash = sha256(Buffer.from(dataB64));
  const privkey = await getPrivateKey();
  const signature = schnorr.sign(messageHash, privkey);
  return `${dataB64}.${Buffer.from(signature).toString('hex')}`;
}

exports.handler = async (event) => {
  // Verify Stripe webhook
  const stripeEvent = verifyStripeWebhook(event);
  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'Ignored' };
  }

  const session = stripeEvent.data.object;
  const email = session.customer_email;
  const name = session.custom_fields?.find(f => f.key === 'name')?.text?.value;
  const npub = session.custom_fields?.find(f => f.key === 'npub')?.text?.value;
  const tier = npub ? 'verified' : 'supporter';

  // Build license (private)
  const license = {
    product: "daylightstation",
    version: "1.x",
    tier: tier,
    licensed_to: name || email,
    email: email,
    npub: npub || null,
    issued: Math.floor(Date.now() / 1000),
    nonce: crypto.randomBytes(8).toString('hex')
  };
  const licenseKey = signData(license);

  // Build badge certificate (public) - only if Verified
  let badgeCert = null;
  if (npub) {
    const badge = {
      npub: npub,
      tier: tier,
      issued: license.issued
    };
    badgeCert = signData(badge);
  }

  // Send via email or return directly
  await sendCredentialsEmail(email, licenseKey, badgeCert);

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
```

### Upgrade Endpoint

```javascript
// /api/upgrade
exports.handler = async (event) => {
  const { old_license, new_npub } = JSON.parse(event.body);

  // Verify old license signature
  const oldData = verifyAndDecode(old_license, YOUR_PUBKEY);
  if (!oldData.valid) {
    return { statusCode: 400, body: 'Invalid license' };
  }

  // Validate new npub format
  if (!new_npub.startsWith('npub1') || new_npub.length !== 63) {
    return { statusCode: 400, body: 'Invalid npub format' };
  }

  // Build new license
  const newLicense = {
    ...oldData,
    tier: 'verified',
    npub: new_npub,
    upgraded: Math.floor(Date.now() / 1000),
    previous_nonce: oldData.nonce,
    nonce: crypto.randomBytes(8).toString('hex')
  };
  const licenseKey = signData(newLicense);

  // Build badge certificate
  const badge = {
    npub: new_npub,
    tier: 'verified',
    issued: newLicense.upgraded
  };
  const badgeCert = signData(badge);

  return {
    statusCode: 200,
    body: JSON.stringify({ license: licenseKey, badge: badgeCert })
  };
};
```

---

## App-Side Implementation

### License Verification

```python
# YOUR pubkey - hardcoded in official build
LICENSING_PUBKEY_HEX = "a1b2c3..."

def verify_credential(credential: str) -> dict:
    """Verify a license or badge certificate."""
    try:
        data_b64, sig_hex = credential.rsplit(".", 1)
        data = json.loads(base64.b64decode(data_b64))

        message_hash = hashlib.sha256(data_b64.encode()).digest()
        pubkey = PublicKey(bytes.fromhex(LICENSING_PUBKEY_HEX), raw=True)

        if not pubkey.schnorr_verify(message_hash, bytes.fromhex(sig_hex), raw=True):
            return {"valid": False, "reason": "Invalid signature"}

        return {"valid": True, **data}
    except Exception as e:
        return {"valid": False, "reason": str(e)}
```

### App Activation Flow

```python
def activate_license(license_key: str) -> dict:
    result = verify_credential(license_key)

    if not result["valid"]:
        return {"tier": "guest", "error": result["reason"]}

    tier = result["tier"]

    # Supporter: no identity verification needed
    if tier == "supporter":
        save_license(license_key)
        return {"tier": "supporter", "name": result["licensed_to"]}

    # Verified: must prove npub ownership
    if tier == "verified":
        npub = result["npub"]
        if not verify_npub_ownership(npub):
            return {"tier": "guest", "error": "Identity verification failed"}

        save_license(license_key)
        save_badge(result.get("badge"))
        return {"tier": "verified", "name": result["licensed_to"], "npub": npub}

    return {"tier": "guest"}
```

### npub Ownership Verification

```python
def verify_npub_ownership(npub: str) -> bool:
    """Challenge user to prove they control the npub."""
    challenge = f"daylightstation:verify:{secrets.token_hex(16)}"

    # Get signature from user (via extension or manual)
    signature = prompt_user_to_sign(challenge)

    # Verify signature matches npub
    pubkey_hex = npub_to_hex(npub)
    message_hash = hashlib.sha256(challenge.encode()).digest()

    return verify_schnorr(message_hash, signature, pubkey_hex)
```

---

## Network Badge Verification

### Publishing Events with Badge

```python
def publish_social_event(content: str, kind: int):
    badge_cert = load_badge_certificate()

    tags = [["d", "..."], ...]
    if badge_cert:
        tags.append(["badge", badge_cert])

    event = {
        "kind": kind,
        "content": content,
        "pubkey": my_pubkey_hex,
        "tags": tags,
        "created_at": int(time.time())
    }

    sign_and_publish(event)
```

### Verifying Incoming Events

```python
TIER_BADGES = {
    "backer": "✓ Backer",
    "sponsor": "🏆 Sponsor",
    "patron": "💎 Patron",
    "benefactor": "👑 Benefactor",
    "medici": "⭐ Medici"
}

def get_network_badge(event: dict) -> str:
    """Determine badge to display for an event author."""
    badge_cert = get_tag(event, "badge")

    # No badge attached
    if not badge_cert:
        return "🚨 Intruder"

    # Verify badge signature
    result = verify_credential(badge_cert)
    if not result["valid"]:
        return "🚨 Intruder"

    # Badge must match event author
    if npub_to_hex(result["npub"]) != event["pubkey"]:
        return "🚨 Intruder"

    # Check badge expiration (valid_until)
    now = int(time.time())
    valid_until = result.get("valid_until", 0)
    if valid_until < now:
        return "🔓 Stale Badge"  # Badge cert expired, needs refresh

    # Check payment status
    status = result.get("status", "active")
    tier = result.get("tier", "backer")
    lifetime = result.get("lifetime", False)

    if status == "active":
        badge = TIER_BADGES.get(tier, "✓ Backer")
        if lifetime:
            badge += " 🎖️"  # Lifetime indicator
        return badge
    elif status == "past_due":
        return "⚠️ Delinquent"
    elif status == "lapsed":
        return "🪦 Lapsed"
    else:
        return "🚨 Intruder"
```

### Display

```
┌─────────────────────────────────────────────────────────────┐
│  Friend Activity                                            │
│                                                             │
│  ⭐🎖️ @whale: Just donated to charity                       │
│     └─ Medici (Lifetime)                                    │
│                                                             │
│  👑 @kckern: Finished a 5k run                              │
│     └─ Benefactor                                           │
│                                                             │
│  💎 @alice: New recipe in shared folder                     │
│     └─ Patron                                               │
│                                                             │
│  🏆 @bob: Watched Severance                                 │
│     └─ Sponsor                                              │
│                                                             │
│  ✓ @newbie: Just joined!                                    │
│     └─ Backer                                               │
│                                                             │
│  ⚠️ @latepayer: Card declined...                            │
│     └─ Delinquent                                           │
│                                                             │
│  🪦 @cancelled: Used to be a Patron                         │
│     └─ Lapsed                                               │
│                                                             │
│  🚨 @hacker42: Check out my setup                           │
│     └─ Intruder                                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Tiered Feature Limits (Draft)

*Idea: Gate quantitative limits by tier. Numbers TBD.*

| Resource | Freeloader | Backer | Sponsor | Patron | Benefactor | Medici |
|----------|------------|--------|---------|--------|------------|--------|
| Adapters | 3 | 5 | 10 | 25 | 50 | ∞ |
| Screens/Dashboards | 1 | 3 | 5 | 10 | 25 | ∞ |
| Data sources | 2 | 5 | 10 | 25 | 50 | ∞ |
| Automation rules | 5 | 10 | 25 | 50 | 100 | ∞ |
| History retention | 7 days | 30 days | 90 days | 1 year | 3 years | ∞ |

### Enforcement

```python
TIER_LIMITS = {
    "freeloader": {"adapters": 3, "screens": 1, "sources": 2},
    "backer":     {"adapters": 5, "screens": 3, "sources": 5},
    "sponsor":    {"adapters": 10, "screens": 5, "sources": 10},
    "patron":     {"adapters": 25, "screens": 10, "sources": 25},
    "benefactor": {"adapters": 50, "screens": 25, "sources": 50},
    "medici":     {"adapters": float('inf'), "screens": float('inf'), "sources": float('inf')},
}

def can_add_adapter():
    tier = get_tier()
    current = count_adapters()
    limit = TIER_LIMITS[tier]["adapters"]
    return current < limit
```

### Notes

- Limits enforced in official build only (hackers can bypass locally)
- Soft limits with upgrade prompts vs hard blocks?
- Grandfather existing users if limits added later?

---

## Why Badges Can't Be Forged

| Attack | Result |
|--------|--------|
| No badge tag | Shows "🚨 Intruder" |
| Forged badge signature | Signature verification fails → "🚨 Intruder" |
| Copy someone else's badge | npub doesn't match event pubkey → "🚨 Intruder" |
| Modify badge data | Signature no longer valid → "🚨 Intruder" |
| Hack client to show fake badge | Other users' clients still verify → they see "🚨 Intruder" |

**Your signing key (nsec) is the root of trust. Without it, valid badges cannot be created.**

---

## Social Features (Verified Tier Only)

### Available Features

- Share activity with friends (workouts, media, meals)
- View friend dashboards
- Accountability groups and habit competitions
- Shared photo albums
- Recipe sharing
- Home automation sharing
- Encrypted cloud backup

### Custom Nostr Event Kinds

| Kind | Purpose |
|------|---------|
| 31337 | Media recommendation |
| 31338 | Recipe/meal share |
| 31339 | Home automation share |
| 31340 | Habit/streak update |
| 31341 | Photo album metadata |
| 31342 | Encrypted backup |
| 31343 | Friend activity summary |

### Privacy Controls

Users opt-in to each data source:

```
┌─────────────────────────────────────────────────────────────┐
│  Social Sharing Settings                                    │
│                                                             │
│  Share with friends:                                        │
│  ☑ Workout summaries                                        │
│  ☑ Media ratings                                            │
│  ☐ Calendar events                                          │
│  ☐ Meal logs                                                │
│                                                             │
│  Friends:                                                   │
│  • @alice (npub1alice...)                                   │
│  • @bob (npub1bob...)                                       │
│  [+ Add friend]                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Identity Anchoring

Your licensing pubkey should be publicly anchored:

### In GitHub README

```markdown
## License Verification

DaylightStation licenses are cryptographically signed.

**Licensing Public Key:** `npub1yourlicensingkey...`

Controlled by [@kckern](https://github.com/kckern)
```

### In Your Nostr Profile

Reference the licensing key from your personal npub, or use your personal npub as the licensing key.

---

## Cost Estimate

| Component | Cost |
|-----------|------|
| AWS Lambda | ~$0.20/month |
| API Gateway | ~$0.10/month |
| Secrets Manager | $0.40/month |
| Amplify Hosting | Free tier |
| Stripe fees | 2.9% + $0.30/txn |
| **Total** | **~$0.70/month** + Stripe fees |

---

## Implementation Checklist

### Phase 1: Key Infrastructure
- [ ] Generate dedicated licensing keypair
- [ ] Store nsec in AWS Secrets Manager
- [ ] Add npub to DaylightStation README
- [ ] Add npub to your Nostr profile

### Phase 2: AWS Backend
- [ ] Create Lambda for license issuance
- [ ] Create Lambda for free upgrade/reissue
- [ ] Set up API Gateway endpoints
- [ ] Configure Stripe products and webhook
- [ ] Test purchase flow end-to-end

### Phase 3: App Integration
- [ ] Add license verification code
- [ ] Add npub ownership challenge
- [ ] Implement tier-based feature gating
- [ ] Add badge certificate storage
- [ ] Build activation UI

### Phase 4: Network Features
- [ ] Attach badge cert to outgoing events
- [ ] Verify badges on incoming events
- [ ] Display appropriate badges in UI
- [ ] Implement social features (Verified only)

### Phase 5: Website
- [ ] Checkout page with optional npub field
- [ ] Upgrade page for adding/changing npub
- [ ] License recovery (by email)

---

## Security Checklist

- [ ] Licensing nsec NEVER in git
- [ ] nsec stored in AWS Secrets Manager
- [ ] Lambda IAM role has least-privilege
- [ ] Stripe webhook signature verified
- [ ] npub ownership verified before issuing Verified tier
- [ ] Badge contains no PII
- [ ] YOUR pubkey hardcoded in official build

---

## Questions to Decide

1. **Exact pricing?** - Current: Backer $10, Sponsor $25, Patron $50, Benefactor $100, Medici $500
2. **License recovery?** - Email-based lookup if user loses license key?
3. **Rate limiting?** - How many npub changes per year?
4. **Revocation?** - Publish revoked badges to relay for abuse cases?
5. **Default relay?** - Use your relay as default for social features?
6. **Renewal reminders?** - Email notifications before expiration?
7. **Grace period length?** - Currently 30 days after expiration

---

## Quick Reference

### Tier Pricing

| Tier | Monthly | Annual | Lifetime | Badge |
|------|---------|--------|----------|-------|
| Freeloader | Free | Free | Free | - |
| Backer | $1 | $10 | $50 | ✓ |
| Sponsor | $3 | $25 | $125 | 🏆 |
| Patron | $5 | $50 | $250 | 💎 |
| Benefactor | $10 | $100 | $500 | 👑 |
| Medici | $50 | $500 | $2500 | ⭐ |

### User Actions

| Action | Cost | Endpoint |
|--------|------|----------|
| Purchase subscription | Tier price | /checkout |
| Purchase lifetime | 5x annual | /checkout |
| Add npub | Free | /upgrade |
| Change npub | Free | /upgrade |
| Upgrade tier (mid-cycle) | Prorated | Stripe portal |
| Downgrade tier | At next billing | Stripe portal |
| Cancel subscription | - | Stripe portal |
| Resubscribe | Tier price | /checkout |
| Refresh badge | Free (automatic) | /api/refresh-badge |

### Badge States

| Payment Status | Network Display |
|----------------|-----------------|
| Active (subscription) | Tier badge (✓ 🏆 💎 👑 ⭐) |
| Active (lifetime) | Tier badge + 🎖️ |
| Past due | ⚠️ Delinquent |
| Cancelled/lapsed | 🪦 Lapsed |
| No license / no npub | N/A (no social) |
| Hacked (no valid badge) | 🚨 Intruder |
| Stale badge cert | 🔓 Stale Badge |

### Credential Lifecycle

| Credential | Lifespan | Refresh |
|------------|----------|---------|
| License | Permanent | Never (reissue for npub/tier change) |
| Badge Certificate | 30 days | Automatic via API |
