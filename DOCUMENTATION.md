# VoxPay — Complete Documentation
## Android MVP · React Native 0.84.1 · Windows Dev Environment

---

# TABLE OF CONTENTS

1. [What This App Actually Is](#1-what-this-app-actually-is)
2. [File Structure — What Every File Does](#2-file-structure)
3. [Setting Up Your Windows Environment](#3-windows-setup)
4. [Getting Your API Keys](#4-api-keys)
5. [Running on Android](#5-running-on-android)
6. [The Smart Payment Routing Feature](#6-smart-routing)
7. [Database Strategy — MVP vs Scale](#7-database)
8. [YC Demo Playbook](#8-yc-demo-playbook)
9. [Common Errors and Fixes](#9-troubleshooting)
10. [What to Build Next](#10-next-steps)

---

# 1. WHAT THIS APP ACTUALLY IS

VoxPay is a voice-authorized payment app. The core idea: you speak a payment command, the app verifies it's YOU speaking, assesses whether the transaction is risky, picks the best payment method automatically, and sends the money.

## The Three Security Gates

Every voice payment runs through three invisible gates before money moves:

```
User speaks → [Gate 1: Is this real speech?]
                       ↓
              [Gate 2: Is this the right person?]
                       ↓
              [Gate 3: Does this transaction make sense?]
                       ↓
              Confirmation screen → Payment executes
```

**Gate 1 — Liveness** (simplified for MVP)
Detects whether audio came from a real person vs. a recording or synthetic voice.
In the MVP, this is handled implicitly by Android's speech recognition, which requires live audio input.
Post-funding: replace with SpeechBrain anti-spoofing model.

**Gate 2 — Speaker verification**
Compares the live voice against the enrolled voiceprint stored on-device.
Uses cosine similarity on audio feature vectors.
Score > 0.70 = match. Score < 0.70 = rejected, user prompted to retry or use manual send.

**Gate 3 — Risk engine**
Scores the transaction 0–100 based on:
- Amount vs. user's transaction history
- Whether recipient is new
- Voice confidence score
- Time of day
- Transaction velocity (how many in last hour)
- Cumulative spend (total in last hour)

Score 0–29: approve directly
Score 30–69: show step-up confirmation (extra "are you sure?" screen)
Score 70+: block and explain why

## Smart Payment Routing

When the user says "send fifty dollars to Sarah" (no payment method specified), the router:
1. Checks which services the user has linked AND has sufficient balance
2. Checks which services Sarah has an account on
3. Picks the intersection — if both qualify, prefers PayPal
4. If nothing qualifies, gives a specific error explaining exactly what's missing

The confirmation screen shows "⚡ Auto-routed via PayPal — $240.00 available" so the user understands what happened.

---

# 2. FILE STRUCTURE

```
VoxPay/
├── App.tsx                          ← Entry point. Mounts navigation.
├── package.json                     ← All dependencies listed here
├── .env.example                     ← Copy to .env and fill in API keys
│
├── src/
│   ├── store/
│   │   └── appStore.ts             ← ALL global state (Zustand)
│   │                                  User, contacts, transactions, balances
│   │                                  Think of this as your in-memory database
│   │
│   ├── services/
│   │   ├── voiceService.ts         ← Voice recording + speaker verification
│   │   │                              Enrollment: record 3 utterances, save features
│   │   │                              Verification: compare live audio to stored features
│   │   │                              STT: wraps @react-native-voice/voice (Android built-in)
│   │   │
│   │   ├── intentParser.ts         ← Converts "send fifty to sarah" into structured data
│   │   │                              {amount: 50, recipientName: "Sarah", method: null}
│   │   │                              Pure TypeScript regex — no API, no model
│   │   │
│   │   ├── paymentRouter.ts        ← SMART ROUTING — picks PayPal vs Stripe automatically
│   │   │                              Checks: sender balance, recipient account, method preference
│   │   │                              Returns: which method to use + why
│   │   │
│   │   ├── riskEngine.ts           ← Transaction risk scoring (0–100)
│   │   │                              Your proprietary business logic
│   │   │                              7 rules → score → approve/stepup/block
│   │   │
│   │   ├── paypalService.ts        ← PayPal REST API v2 Payouts
│   │   │                              Sandbox works without partnership approval
│   │   │                              OAuth token cached, idempotency key prevents double-send
│   │   │
│   │   └── stripeService.ts        ← Stripe PaymentIntents via your backend
│   │                                  App → your server → Stripe (secret key stays on server)
│   │
│   ├── hooks/
│   │   └── useVoicePayment.ts      ← THE ORCHESTRATOR
│   │                                  Connects all services into one state machine
│   │                                  States: idle → listening → processing → confirming → executing → success/failed
│   │                                  Used by VoiceScreen
│   │
│   ├── screens/
│   │   ├── VoiceScreen.tsx         ← THE DEMO SCREEN. Renders the full payment flow.
│   │   ├── EnrollmentScreen.tsx    ← 3-utterance voice enrollment (first-time setup)
│   │   └── AllScreens.tsx          ← Contacts, History, Settings, ManualSend combined
│   │                                  (split into separate files once the app grows)
│   │
│   ├── navigation/
│   │   └── AppNavigator.tsx        ← Tab nav (Pay/People/History/Settings) + Stack nav
│   │                                  Routes to Enrollment on first launch if not enrolled
│   │
│   └── utils/
│       └── demoSeed.ts             ← Pre-loads demo data (contacts, past transactions, user)
│                                      Run before YC demo. Fill in your sandbox emails here.
│
└── server/
    ├── index.js                    ← Node.js Express backend (Stripe secret key lives here)
    └── package.json                ← Server dependencies (express, stripe, cors, dotenv)
```

## Data Flow (trace a single payment)

```
User says: "Send fifty dollars to Sarah"
     │
     ▼
VoiceScreen.tsx (UI)
  calls → useVoicePayment.ts (orchestrator)
     │
     ├─ voiceService.ts
     │    startListening() → Android STT → transcript: "send fifty dollars to sarah"
     │    recordAudioClip() → audio file
     │    verifyVoice(audioFile) → { isMatch: true, score: 0.88 }
     │
     ├─ intentParser.ts
     │    parseIntent("send fifty dollars to sarah")
     │    → { amount: 50, recipientName: "Sarah", paymentMethod: null }
     │
     ├─ appStore.ts
     │    resolveContacts("Sarah") → finds Contact { id: "001", name: "Sarah Johnson", paypalEmail: "..." }
     │
     ├─ paymentRouter.ts
     │    routePayment(50, sarah, userBalances, null)
     │    → { canRoute: true, method: "paypal", reason: "Auto-routed — $240 available", autoRouted: true }
     │
     ├─ riskEngine.ts
     │    assessRisk({ amount: 50, isNewRecipient: false, voiceConfidence: 0.88, ... })
     │    → { score: 8, level: "low", action: "approve" }
     │
     ▼
VoiceScreen shows confirmation:
  "$50.00 to Sarah Johnson — ⚡ Auto-routed via PayPal — $240 available"
  "🎙️ Voice match: 88%"
     │
User taps "Send →"
     │
     ├─ paypalService.ts
     │    sendPayPalPayment("sarah@sandbox.com", 50, "Alex Rivera", idempotencyKey)
     │    → PayPal API → { success: true, batchId: "PPB-..." }
     │
     ├─ appStore.ts
     │    updateTransaction(id, { status: "completed" })
     │
     ▼
VoiceScreen shows: "✅ Sent!"
```

---

# 3. WINDOWS SETUP

## Prerequisites (install in this order)

### Step 1 — Node.js
Download from https://nodejs.org — get the LTS version (20.x or 22.x)
After install, open a new Command Prompt and verify:
```
node --version    → should show v20.x.x or v22.x.x
npm --version     → should show 10.x.x
```

### Step 2 — Java Development Kit 17
React Native 0.84 requires Java 17 specifically.
Download: https://adoptium.net/temurin/releases/?version=17
Pick: Windows x64, JDK, .msi installer
After install, verify:
```
java --version    → should show openjdk 17.x.x
```
If it shows a different version, you need to set JAVA_HOME:
1. Search Windows → "Environment Variables"
2. Under System Variables → New
   Variable name: JAVA_HOME
   Variable value: C:\Program Files\Eclipse Adoptium\jdk-17.x.x-hotspot
3. Find "Path" in System Variables → Edit → New → %JAVA_HOME%\bin

### Step 3 — Android Studio
Download from https://developer.android.com/studio
During install, make sure these are checked:
- Android SDK
- Android SDK Platform
- Android Virtual Device

After install, open Android Studio:
1. Go to SDK Manager (top menu: Tools → SDK Manager)
2. Under SDK Platforms tab: check Android 14 (API 34)
3. Under SDK Tools tab: check these:
   - Android SDK Build-Tools 34
   - Android SDK Command-line Tools
   - Android Emulator
   - Android SDK Platform-Tools
4. Click Apply → OK

Set Android environment variables:
1. Search Windows → "Environment Variables"
2. Under System Variables → New:
   Variable name: ANDROID_HOME
   Variable value: C:\Users\YOUR_USERNAME\AppData\Local\Android\Sdk
3. Find "Path" → Edit → Add these two:
   %ANDROID_HOME%\platform-tools
   %ANDROID_HOME%\emulator

Verify:
```
adb --version     → should show Android Debug Bridge version
```

### Step 4 — Set up Android Emulator
In Android Studio:
1. Go to Device Manager (right panel or Tools → Device Manager)
2. Click "Create Virtual Device"
3. Pick: Pixel 7 → Next
4. System Image: API 34 (download if needed) → Next
5. Name it "Pixel7_API34" → Finish
6. Click the Play button (▶) to start the emulator
7. Wait for it to boot fully (takes 1-2 minutes first time)

---

# 4. API KEYS

## PayPal Sandbox (15 minutes)

1. Go to https://developer.paypal.com
2. Create a developer account (free, no credit card)
3. Click "Apps & Credentials" in the top menu
4. Make sure you're in "Sandbox" mode (toggle in top right)
5. Click "Create App"
   - App Name: VoxPay Demo
   - App Type: Merchant
6. Copy "Client ID" and "Secret" — paste into your .env file

Create sandbox accounts for testing:
1. Go to Testing Tools → Sandbox Accounts
2. You'll see auto-created Business and Personal accounts
3. Click on a Personal account → View/Edit → check the balance (should be $5,000 fake money)
4. Note the email address — this is what you put in demoSeed.ts as the recipient email
5. To see if payments went through: log into https://sandbox.paypal.com with that account

## Stripe (5 minutes)

1. Go to https://dashboard.stripe.com
2. Sign up free
3. IMPORTANT: Make sure you're in "Test mode" (toggle in left sidebar — should show orange "TEST")
4. Go to Developers → API Keys
5. Copy "Publishable key" (starts with pk_test_) → .env STRIPE_PUBLISHABLE_KEY
6. Copy "Secret key" (click Reveal, starts with sk_test_) → .env STRIPE_SECRET_KEY

Stripe test cards (use in sandbox, these always work):
- Success: 4242 4242 4242 4242
- Decline: 4000 0000 0000 0002

## Fill in your .env

```
PAYPAL_CLIENT_ID=AaBbCcDdEe...         ← from PayPal dashboard
PAYPAL_CLIENT_SECRET=EeFfGgHh...       ← from PayPal dashboard
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com

STRIPE_PUBLISHABLE_KEY=pk_test_...     ← from Stripe dashboard
STRIPE_SECRET_KEY=sk_test_...          ← from Stripe dashboard

API_BASE_URL=http://10.0.2.2:3001      ← for Android emulator
```

NOTE: 10.0.2.2 is Android emulator's way of reaching your Windows localhost.
If testing on a real physical Android device connected via USB,
use ngrok instead:
```
npx ngrok http 3001
```
Then update API_BASE_URL to the ngrok HTTPS URL (e.g., https://abc123.ngrok.io)

---

# 5. RUNNING ON ANDROID

## First-time setup

```bash
# 1. Navigate to the project
cd VoxPay

# 2. Install all npm packages
npm install

# 3. Copy environment config
copy .env.example .env
# Then open .env and fill in your API keys

# 4. Start the backend server (in a separate terminal window)
cd server
npm install
node index.js
# You should see: "VoxPay backend running on http://localhost:3001"

# 5. Go back to project root
cd ..

# 6. Start the Metro bundler (keep this running)
npm start

# 7. In another terminal — build and run on Android
npm run android
```

First run takes 3-5 minutes (Gradle downloads dependencies).
Subsequent runs take 30-60 seconds.

## What you should see

1. Android emulator boots showing the VoxPay enrollment screen
2. Three dots at top → you need to record 3 voice utterances
3. Tap record, say the phrase shown, tap done
4. After 3 utterances → "Voice enrolled!" → tap "Start using VoxPay"
5. Main app loads: Pay / People / History / Settings tabs
6. Tap People → Add contacts with their PayPal/Stripe emails
7. Tap Pay → Tap mic → Speak → Money moves

## Running after first setup

```bash
# Terminal 1: backend
cd server && node index.js

# Terminal 2: Metro bundler  
npm start

# Terminal 3: build to emulator
npm run android
```

Or if app is already installed, just start Metro and the backend.
The app will hot-reload when you change code.

## Testing on a real Android phone

1. Enable Developer Options on your phone:
   Settings → About Phone → tap "Build Number" 7 times
2. Enable USB Debugging: Settings → Developer Options → USB Debugging → ON
3. Connect phone to Windows via USB
4. Accept the "Allow USB Debugging?" prompt on the phone
5. Verify it's detected: `adb devices` → should show your device
6. Set up ngrok for the backend: `npx ngrok http 3001`
7. Update .env: API_BASE_URL=https://YOUR-NGROK-URL.ngrok.io
8. Run: `npm run android`

---

# 6. SMART ROUTING

## How it works (the feature you asked for)

When a user says "send fifty dollars to Sarah" — no payment method mentioned —
the system automatically picks the right one.

The logic in `src/services/paymentRouter.ts`:

```
Does the user have sufficient balance on PayPal? AND does Sarah have a PayPal email?
  → YES: Use PayPal

Does the user have sufficient balance on Stripe? AND does Sarah have a Stripe email?  
  → YES: Use Stripe (fallback)

Neither works?
  → Give a specific error:
    "Sarah doesn't have a Stripe email on file. Add it in People → Sarah → Edit"
    or
    "Insufficient PayPal balance. You have $30, need $50."
```

## What the user sees

On the confirmation screen:
```
$50.00
to Sarah Johnson

⚡ Auto-routed via PayPal
"Auto-routed via PayPal — $240.00 available, sending $50.00"

🎙️ Voice match: 88%
```

If they DID specify a method ("send fifty to sarah via paypal"):
```
📌 Requested via PayPal
```

## Demo scenarios for smart routing

**Scenario: auto-routing works**
Say: "Send thirty dollars to Mike"
Expected: system picks PayPal (user has $240, Mike has PayPal email)
Shows: "⚡ Auto-routed via PayPal"

**Scenario: insufficient balance forces alternate**
Set user's PayPal balance to $10 in demoSeed.ts, Stripe to $500
Say: "Send fifty dollars to Sarah"
Expected: system skips PayPal (insufficient), routes to Stripe
Shows: "⚡ Auto-routed via Stripe — $500.00 available"

**Scenario: routing fails with clear error**
Say: "Send fifty dollars to Alex Kim"
Alex Kim only has Stripe email, no PayPal
Expected: routes to Stripe
(If Stripe balance also insufficient → clear error message)

---

# 7. DATABASE STRATEGY

## Current state: NO database

Right now, ALL data lives in Zustand (in-memory JavaScript state).

What this means practically:
- Data resets every time the app is killed and reopened
- Works perfectly for a YC demo (you control the session)
- Cannot scale beyond a single device
- No multi-device sync
- No server-side fraud detection
- No compliance audit trail

The only thing that persists between app restarts is:
- The voiceprint (saved to AsyncStorage — survives app restart)

Everything else (contacts, transactions, user profile, balances) lives in RAM.

## What to tell YC about this

Be direct. Don't hide it. Say:

> "For this demo, state is in-memory. Post-funding our first technical priority
> is a proper backend with a real database. The architecture is designed
> to swap this out — every state mutation goes through a single Zustand store,
> so adding persistence is a clean lift-and-shift, not a rewrite."

YC knows MVPs don't have full databases. They care that you understand the gap.

## Scaling architecture (post-funding)

### Phase 1: Add persistence (Month 1–2 after funding)

Replace Zustand's in-memory state with calls to a backend API.
Keep Zustand as the local cache (fast UI), sync to server async.

Stack:
```
React Native app
    ↕ REST API
Node.js / Express backend
    ↕
PostgreSQL (user data, contacts, transactions)
Redis (session cache, token cache, rate limiting)
```

Each current service maps directly to a database table:

| Current (in-memory)       | Production database         |
|---------------------------|----------------------------|
| user in appStore          | users table                |
| contacts in appStore      | contacts table             |
| transactions in appStore  | transactions table         |
| voiceprint in AsyncStorage| voice_profiles table (encrypted) |
| paymentBalances in appStore| fetched live from PayPal/Stripe APIs |

### Phase 2: Real-time fraud detection (Month 3–6)

Add a fraud events table. Every transaction attempt gets logged with:
- Voice confidence score
- Risk score breakdown
- Device fingerprint
- Outcome (approved/blocked/stepped-up)

This labeled data trains your XGBoost fraud model.
The more transactions, the smarter the model becomes.
This data flywheel is your competitive moat.

### Phase 3: Multi-user, multi-device (Month 6–12)

Add authentication (JWT tokens, refresh tokens).
Voiceprint syncs encrypted to server — user can use app on multiple devices.
Contacts sync across devices.
Transaction history available on web dashboard.

### Phase 4: Bank partnership integration (Year 2)

FedNow real-time payment rail replaces PayPal/Stripe for bank partners.
Each bank partner gets a white-label SDK.
Your database becomes the source of truth for fraud signals across all partners.
Revenue model: per-transaction fee × millions of daily transactions.

### Database schema (when you build it)

```sql
-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Voice profiles (encrypted at rest)
CREATE TABLE voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  profile_data BYTEA NOT NULL,   -- encrypted voiceprint bytes
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  device_id TEXT
);

-- Contacts
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID REFERENCES users(id),
  name TEXT NOT NULL,
  paypal_email TEXT,
  stripe_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transactions (immutable audit log — never update, only insert)
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  sender_user_id UUID REFERENCES users(id),
  recipient_contact_id UUID REFERENCES contacts(id),
  amount DECIMAL(12, 2) NOT NULL,
  currency CHAR(3) DEFAULT 'USD',
  payment_method TEXT NOT NULL,
  status TEXT NOT NULL,
  voice_confidence DECIMAL(5, 4),
  risk_score INTEGER,
  risk_reasons JSONB,
  auto_routed BOOLEAN,
  routing_reason TEXT,
  provider_reference TEXT,       -- PayPal batch ID or Stripe PaymentIntent ID
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Fraud events (for model training)
CREATE TABLE fraud_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID REFERENCES transactions(id),
  event_type TEXT,               -- 'spoofing_attempt', 'velocity_flag', 'block', etc.
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

# 8. YC DEMO PLAYBOOK

## Before the demo (do this the night before)

### 1. Seed the demo data
Open the app, kill it, reopen. The seedDemoData() function runs on first launch.
Verify in the People tab that Sarah Johnson, Mike Chen, Mom, and Alex Kim are there.
Verify in Settings that PayPal shows $240.00 and Stripe shows $85.50.

### 2. Complete voice enrollment
Go through the enrollment flow. Say the 3 phrases clearly.
After enrollment, you're ready.

### 3. Update sandbox emails in demoSeed.ts
Replace the placeholder emails with your actual PayPal sandbox receiver emails.
Rebuild and reinstall: npm run android

### 4. Verify the backend is running
```
cd server
node index.js
```
Open a browser: http://localhost:3001/health
Should show: {"status":"ok","timestamp":"..."}

### 5. Run the demo scenarios (practice 5 times)
The muscle memory of the demo matters more than anything.

## The five demo scenarios

### Scenario A — The hero moment (lead with this)
```
Action: Tap mic → say "Send fifty dollars to Sarah via PayPal"
What happens:
  • Mic button pulses red while listening
  • Processing spinner (voice verification + risk scoring happening invisibly)
  • Confirmation screen: "$50.00 to Sarah Johnson via PayPal — 🎙️ Voice match: XX%"
  • Tap "Send →"
  • "✅ Sent!"
Why it impresses: The full flow in under 5 seconds. Effortless.
```

### Scenario B — Smart auto-routing (the technical differentiator)
```
Action: Tap mic → say "Send thirty dollars to Mike"
  (No payment method specified — let the router pick)
What happens:
  • System checks: Mike has PayPal, user has $240 PayPal balance
  • Confirmation screen shows: "⚡ Auto-routed via PayPal"
  • "Auto-routed via PayPal — $240.00 available, sending $30.00"
Why it impresses: Shows the intelligence layer. Not just STT — it reasons.
```

### Scenario C — Risk engine step-up (shows safety)
```
Action: Tap mic → say "Send five hundred dollars to Sarah"
What happens:
  • Amount triggers "High-value transaction" rule (score 30+)
  • Step-up screen appears: "⚠️ Extra confirmation required — High-value transaction"
  • Must tap "Confirm anyway →" to proceed
Why it impresses: Shows the system has layered security. Not just voice passthrough.
```

### Scenario D — Wrong voice rejection (the wow moment — do this last)
```
Action: Complete enrollment on your phone
  Hand the phone to someone else in the room
  Tell them to tap mic and say "Send fifty dollars to Sarah via PayPal"
What happens:
  • Their voice doesn't match your voiceprint
  • "Voice not recognized (match: XX%). Please try again or use manual send."
Why it impresses: The most visceral demo beat. Real-time rejection of the wrong person.
  This is the one YC partners remember.
```

### Scenario E — Manual fallback (shows completeness)
```
Action: Tap "Prefer typing? Send manually →"
What happens:
  • Manual send form: enter amount, pick contact, pick method
  • Same confirmation flow
  • Same payment execution
Why it impresses: Shows you thought about failure states. App works even without voice.
```

## What to say during the demo

**Opening (10 seconds):**
"Every payment app today uses the same auth: PIN, Face ID, or fingerprint.
None of them know *who's speaking*. VoxPay does."

**During Scenario A:**
"I just said 'send fifty dollars to Sarah via PayPal.' That's it.
Verified my voice, assessed transaction risk, routed the payment.
Under 5 seconds."

**During Scenario B:**
"Watch this — I don't even specify which service.
I just say 'send thirty to Mike.' The system checks my balances, checks Mike's accounts,
picks the best route automatically. This is what we call smart routing."

**During Scenario D:**
"Hand it to someone. Have them say the same command."
[They get rejected]
"That's Gate 2. The voice biometric running on-device, no cloud needed.
Their voice doesn't match mine. No money moves."

**Closing:**
"We're building the authentication layer that every bank, neobank, and wallet
needs but none of them want to build themselves.
Our model gets smarter with every transaction — the fraud data we accumulate
is worth more than our code."

## Objections and how to handle them

**"Deepfakes can clone your voice"**
"Correct — and that's why voice is one signal, not the only one.
We also check device trust and transaction risk. All three must pass.
And our roadmap includes liveness detection — detecting the acoustic artifacts
that distinguish synthesized speech from real vocal tract output.
That's a funded feature, not a launch feature."

**"Apple and Google can build this"**
"Apple already tried — Siri Shortcuts for PayPal exists. No biometric auth.
Anyone who picks up your unlocked phone can use it.
We're building the verified, multi-rail, fraud-intelligent version.
And we're selling it B2B — to the banks and wallets, not competing with them."

**"Why don't banks just build this internally?"**
"BofA has had Erica since 2018. It's a FAQ bot.
Internal bank teams can't move this fast. They need 18 months of security review
for anything that touches authentication.
We become their vendor, we pass their review once, we're embedded everywhere."

**"What's your business model?"**
"Per-transaction authentication fee — fractions of a cent per verified transaction —
plus a monthly platform fee for enterprise bank partners.
At 10 million daily transactions, that's meaningful revenue."

**"Where's your data stored right now?"**
Be honest:
"This demo uses in-memory state — no database yet.
That's intentional for the MVP. The architecture is clean: a single state layer
that maps directly to a PostgreSQL schema. First week post-funding, that's shipped."

---

# 9. TROUBLESHOOTING

## "JAVA_HOME is not set"
Follow the JAVA_HOME setup in Section 3.
Then restart your terminal and retry.

## "SDK location not found"
1. Open Android Studio → SDK Manager
2. Copy the SDK path shown at the top
3. Create file: VoxPay/android/local.properties
4. Add line: sdk.dir=C\:\\Users\\YOUR_USERNAME\\AppData\\Local\\Android\\Sdk
   (note: backslashes need to be doubled and colon escaped)

## "Could not connect to development server"
The Metro bundler isn't running.
Open a terminal: npm start
Then try again: npm run android

## "Invariant Violation: No routes defined"
The app couldn't find your navigation setup. Usually means a missing import.
Check that all screen names in AppNavigator.tsx match exactly.

## "Unable to load script" on device
The device can't reach Metro on your machine.
Try: adb reverse tcp:8081 tcp:8081
This forwards port 8081 from the device to your computer.

## Microphone permission denied
Go to Android emulator:
Settings → Apps → VoxPay → Permissions → Microphone → Allow

## Voice recognition not starting
@react-native-voice/voice needs Google Speech Services.
The Android emulator includes this. Physical devices also have it.
Make sure the emulator has an internet connection (voice recognition hits Google's API).

## PayPal "INVALID_TOKEN" error
Your cached OAuth token expired. Restart the backend server: node index.js
The token cache resets and a fresh token is fetched.

## Stripe "No such PaymentIntent" error
The backend isn't running or the URL is wrong.
Check: API_BASE_URL in .env matches where your server is running.
For emulator: http://10.0.2.2:3001
For real device with ngrok: https://your-ngrok-url.ngrok.io

## Build fails with "Duplicate class kotlin.collections"
Add to android/app/build.gradle:
```
configurations.all {
  resolutionStrategy {
    force 'org.jetbrains.kotlin:kotlin-stdlib:1.9.0'
  }
}
```

## "Metro has encountered an error" — clearCache
```
npm start -- --reset-cache
```

---

# 10. WHAT TO BUILD NEXT

## In the next 40 days (before YC)

Priority 1 — Get the demo working end-to-end
Focus: enrollment → voice payment → PayPal sends → success screen
Don't add features. Make this loop bulletproof.

Priority 2 — Replace sandbox emails in demoSeed.ts
Your demo fails if the recipient emails don't match real PayPal sandbox accounts.
This is the most likely demo failure point.

Priority 3 — Practice Scenario D (wrong voice rejection)
It's your best demo moment. Practice it 20 times so you execute it smoothly.

Priority 4 — Record a backup demo video
Record the app working perfectly. If live demo fails, play the video.
No excuses needed — just say "let me show you the recorded version."

## Post-YC funding priorities

Week 1: PostgreSQL database, user auth (JWT), voiceprint encrypted at rest
Week 2-4: Real balance fetching from PayPal API + Stripe API (replace hardcoded demo values)
Month 2: FedNow integration (the real-time payment rail banks care about)
Month 3: Proper liveness detection (SpeechBrain anti-spoofing model)
Month 4: First bank/neobank pilot partner integration
Month 6: Proprietary speaker verification model training on accumulated data

## The moat builds over time

```
Today:                Uses off-shelf voice recognition, PayPal/Stripe rails
                      Moat: speed, focus, the three-gate insight

6 months:             10k users, 100k transactions labeled
                      Moat: fraud dataset no competitor has

18 months:            Proprietary voice models trained on payment-specific audio
                      Moat: best-in-class accuracy for short payment commands

36 months:            Embedded in 3+ bank partners, switching cost is enormous
                      Moat: integration depth + regulatory pre-clearance
```

The code you have today is the seed. The data you collect tomorrow is the tree.
