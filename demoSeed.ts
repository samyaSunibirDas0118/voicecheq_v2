// src/utils/demoSeed.ts
// Seeds the app with demo data before the YC presentation.
// Call once from App.tsx on first launch.

import { useAppStore } from '../store/appStore';
import { v4 as uuidv4 } from 'uuid';

export function seedDemoData(): void {
  const store = useAppStore.getState();

  // ── Demo user ─────────────────────────────────────────────────
  // paymentBalances = what you have available on each service
  // These are SIMULATED for demo. Real balances come from PayPal/Stripe APIs.
  store.setUser({
    id: 'demo-user-001',
    name: 'Alex Rivera',
    email: 'alex@voxpay.app',
    phone: '+1 555 000 0001',
    isVoiceEnrolled: false,        // flips to true after enrollment
    paymentBalances: [
      {
        method: 'paypal',
        balance: 240.00,           // user has $240 on PayPal
        accountId: 'alex.sender@sandbox.paypal.com',
        isLinked: true,
      },
      {
        method: 'stripe',
        balance: 85.50,            // user has $85.50 on Stripe
        accountId: 'cus_demo_alex',
        isLinked: true,
      },
    ],
  });

  // ── Demo contacts ─────────────────────────────────────────────
  // REPLACE sandbox emails with your actual PayPal sandbox receiver accounts
  // from: developer.paypal.com → Testing Tools → Sandbox Accounts
  store.setContacts([
    {
      id: 'contact-001',
      name: 'Sarah Johnson',
      avatarInitials: 'SJ',
      paypalEmail: 'sb-sarah@business.example.com',   // ← replace with real sandbox email
      stripeEmail: 'sarah@example.com',
      lastTransactionAt: new Date(Date.now() - 86400000).toISOString(),
    },
    {
      id: 'contact-002',
      name: 'Mike Chen',
      avatarInitials: 'MC',
      paypalEmail: 'sb-mike@business.example.com',    // ← replace with real sandbox email
      stripeEmail: 'mike@example.com',
      lastTransactionAt: new Date(Date.now() - 172800000).toISOString(),
    },
    {
      id: 'contact-003',
      name: 'Mom',
      avatarInitials: '♥',
      paypalEmail: 'sb-sarah@business.example.com',   // reuse for demo
      // No stripeEmail — shows routing will use PayPal only
    },
    {
      id: 'contact-004',
      name: 'Alex Kim',
      avatarInitials: 'AK',
      // No paypalEmail — shows routing will use Stripe only
      stripeEmail: 'alex.k@example.com',
    },
  ]);

  // ── Past transactions ────────────────────────────────────────
  // Pre-seeds history so the risk engine has baseline data
  // and the history screen isn't empty during the demo
  const past = [
    { name: 'Sarah Johnson', id: 'contact-001', amount: 25, method: 'paypal' as const, score: 0.89, risk: 8 },
    { name: 'Mike Chen', id: 'contact-002', amount: 40, method: 'stripe' as const, score: 0.91, risk: 6 },
    { name: 'Sarah Johnson', id: 'contact-001', amount: 15.50, method: 'paypal' as const, score: 0.87, risk: 5 },
    { name: 'Mom', id: 'contact-003', amount: 50, method: 'paypal' as const, score: 0.93, risk: 4 },
  ];

  past.forEach((p, i) => {
    store.addTransaction({
      id: `past-tx-${i}`,
      amount: p.amount,
      currency: 'USD',
      recipientId: p.id,
      recipientName: p.name,
      paymentMethod: p.method,
      status: 'completed',
      voiceConfidence: p.score,
      riskScore: p.risk,
      createdAt: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
      idempotencyKey: uuidv4(),
      autoRouted: i % 2 === 0,
      routingReason: i % 2 === 0 ? 'Auto-routed via PayPal — $240.00 available' : undefined,
    });
  });
}
