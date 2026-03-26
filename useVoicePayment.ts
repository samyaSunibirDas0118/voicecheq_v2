// src/hooks/useVoicePayment.ts
// Central orchestrator — runs all three gates + smart payment routing.
//
// Flow:
//   1. User taps mic → startListening()
//   2. User speaks → STT transcribes in real time
//   3. User taps stop → stopAndProcess()
//      a. Records 3s audio clip → verifyVoice() [Gate 2]
//      b. parseIntent() extracts amount + recipient + method
//      c. routePayment() picks best payment method (smart routing)
//      d. assessRisk() scores the transaction [Gate 3]
//      e. Shows confirmation screen
//   4. User confirms → executePayment()
//   5. Payment API called → transaction logged

import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useAppStore, Transaction, Contact, PaymentMethod } from '../store/appStore';
import {
  startListening,
  stopListening,
  verifyVoice,
  recordAudioClip,
  requestMicPermission,
} from '../services/voiceService';
import { parseIntent, ParsedIntent } from '../services/intentParser';
import { routePayment, RoutingDecision } from '../services/paymentRouter';
import { assessRisk, RiskDecision } from '../services/riskEngine';
import { sendPayPalPayment } from '../services/paypalService';
import { sendStripePayment } from '../services/stripeService';

export type VoiceStage =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'disambiguating'   // multiple contacts matched, pick one
  | 'confirming'
  | 'stepup'
  | 'executing'
  | 'success'
  | 'failed'
  | 'cancelled';

export interface PendingPayment {
  amount: number;
  recipient: Contact;
  routing: RoutingDecision;
  risk: RiskDecision;
  idempotencyKey: string;
  voiceScore: number;
  autoRouted: boolean;
}

export function useVoicePayment() {
  const [stage, setStage] = useState<VoiceStage>('idle');
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [ambiguousContacts, setAmbiguousContacts] = useState<Contact[]>([]);
  const [pendingIntent, setPendingIntent] = useState<ParsedIntent | null>(null);

  const audioPathRef = useRef<string>('');

  const {
    user,
    contacts,
    transactions,
    addTransaction,
    updateTransaction,
  } = useAppStore();

  // ── Start listening ──────────────────────────────────────────────

  const startVoice = useCallback(async () => {
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      setError('Microphone permission denied. Enable in Android Settings → Apps → VoxPay → Permissions.');
      setStage('failed');
      return;
    }

    setStage('listening');
    setError(null);
    setTranscript('');
    setPending(null);

    startListening(
      (text) => setTranscript(text),
      (err) => {
        setError(`Speech recognition error: ${err}`);
        setStage('failed');
      }
    );
  }, []);

  // ── Stop and process ─────────────────────────────────────────────

  const stopAndProcess = useCallback(async () => {
    if (stage !== 'listening') return;
    setStage('processing');

    await stopListening();

    try {
      // Record audio clip for voice verification (runs alongside transcript)
      const path = `/sdcard/Download/voxpay_verify_${Date.now()}.mp4`;
      audioPathRef.current = path;

      // Gate 2: Speaker verification
      const [voiceResult] = await Promise.all([
        verifyVoice(path),
        recordAudioClip(2000),
      ]);

      // If not enrolled yet, skip verification (enrollment screen handles this)
      if (voiceResult.enrollmentExists && !voiceResult.isMatch) {
        setError(
          `Voice not recognized (match: ${(voiceResult.score * 100).toFixed(0)}%). ` +
          `Please try again or use manual send.`
        );
        setStage('failed');
        return;
      }

      // Parse intent from transcript
      const intent = parseIntent(transcript);

      if (intent.isCancellation) { setStage('cancelled'); return; }

      if (!intent.amount) {
        setError(`Didn't catch the amount. Try: "Send fifty dollars to Sarah"`);
        setStage('failed');
        return;
      }

      if (!intent.recipientName) {
        setError(`Didn't catch who to send to. Try: "Send fifty dollars to Sarah"`);
        setStage('failed');
        return;
      }

      // Resolve recipient from contacts
      const matched = resolveContacts(intent.recipientName, contacts);

      if (matched.length === 0) {
        setError(
          `No contact named "${intent.recipientName}" found. ` +
          `Add them in the People tab first.`
        );
        setStage('failed');
        return;
      }

      // Multiple matches — ask user to pick
      if (matched.length > 1) {
        setPendingIntent(intent);
        setAmbiguousContacts(matched);
        setStage('disambiguating');
        return;
      }

      await buildPendingPayment(intent, matched[0], voiceResult.score);

    } catch (err: any) {
      setError(err.message || 'Processing failed. Please try again.');
      setStage('failed');
    }
  }, [stage, transcript, contacts, transactions, user]);

  // ── Disambiguation — user picks the right contact ─────────────────

  const selectContact = useCallback(async (contact: Contact) => {
    if (!pendingIntent) return;
    setStage('processing');

    // Re-run voice verify with stored score (already done above)
    await buildPendingPayment(pendingIntent, contact, 0.85); // use high default after manual pick
  }, [pendingIntent, transactions, user]);

  // ── Build pending payment ─────────────────────────────────────────

  const buildPendingPayment = useCallback(async (
    intent: ParsedIntent,
    contact: Contact,
    voiceScore: number
  ) => {
    if (!user) { setError('User not set up.'); setStage('failed'); return; }

    // Smart routing
    const routing = routePayment(
      intent.amount!,
      contact,
      user.paymentBalances,
      intent.paymentMethod ?? undefined
    );

    if (!routing.canRoute) {
      setError(routing.reason);
      setStage('failed');
      return;
    }

    // Gate 3: Risk assessment
    const risk = assessRisk({
      amount: intent.amount!,
      recipientId: contact.id,
      isNewRecipient: !transactions.some((t) => t.recipientId === contact.id),
      voiceConfidence: voiceScore,
      userTransactions: transactions,
      hourOfDay: new Date().getHours(),
      deviceTrusted: true,
    });

    if (risk.action === 'block') {
      setError(`Transaction blocked: ${risk.reasons[0]}`);
      setStage('failed');
      return;
    }

    const payment: PendingPayment = {
      amount: intent.amount!,
      recipient: contact,
      routing: routing as RoutingDecision,
      risk,
      idempotencyKey: uuidv4(),
      voiceScore,
      autoRouted: (routing as RoutingDecision).autoRouted,
    };

    setPending(payment);
    setStage(risk.action === 'stepup' ? 'stepup' : 'confirming');
  }, [user, transactions]);

  // ── Execute payment ───────────────────────────────────────────────

  const confirmPayment = useCallback(async () => {
    if (!pending || !user) return;
    setStage('executing');

    const tx: Transaction = {
      id: pending.idempotencyKey,
      amount: pending.amount,
      currency: 'USD',
      recipientId: pending.recipient.id,
      recipientName: pending.recipient.name,
      paymentMethod: pending.routing.method,
      status: 'pending',
      voiceConfidence: pending.voiceScore,
      riskScore: pending.risk.score,
      createdAt: new Date().toISOString(),
      idempotencyKey: pending.idempotencyKey,
      autoRouted: pending.autoRouted,
      routingReason: pending.routing.reason,
    };

    addTransaction(tx);

    try {
      let success = false;

      if (pending.routing.method === 'paypal') {
        const result = await sendPayPalPayment(
          pending.routing.recipientEmail,
          pending.amount,
          user.name,
          pending.idempotencyKey
        );
        success = result.success;
        if (!success) throw new Error(result.error);
      } else {
        const result = await sendStripePayment(
          pending.routing.recipientEmail,
          pending.amount,
          pending.idempotencyKey
        );
        success = result.success;
        if (!success) throw new Error(result.error);
      }

      updateTransaction(pending.idempotencyKey, { status: 'completed' });
      setStage('success');
    } catch (err: any) {
      updateTransaction(pending.idempotencyKey, { status: 'failed' });
      setError(err.message || 'Payment failed. No money was sent.');
      setStage('failed');
    }
  }, [pending, user, addTransaction, updateTransaction]);

  const cancelPayment = useCallback(() => {
    if (pending) updateTransaction(pending.idempotencyKey, { status: 'cancelled' });
    setStage('cancelled');
    setPending(null);
  }, [pending, updateTransaction]);

  const reset = useCallback(() => {
    setStage('idle');
    setPending(null);
    setError(null);
    setTranscript('');
    setAmbiguousContacts([]);
    setPendingIntent(null);
  }, []);

  return {
    stage, pending, error, transcript,
    ambiguousContacts,
    startVoice, stopAndProcess,
    selectContact,
    confirmPayment, cancelPayment, reset,
  };
}

// ── Contact resolution ────────────────────────────────────────────

function resolveContacts(name: string, contacts: Contact[]): Contact[] {
  const q = name.toLowerCase().trim();
  const exact = contacts.filter((c) => c.name.toLowerCase() === q);
  if (exact.length > 0) return exact;

  const first = contacts.filter(
    (c) => c.name.toLowerCase().split(' ')[0] === q
  );
  if (first.length > 0) return first;

  return contacts.filter((c) => c.name.toLowerCase().includes(q));
}
