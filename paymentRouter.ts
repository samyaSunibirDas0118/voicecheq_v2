// src/services/paymentRouter.ts
//
// SMART PAYMENT ROUTING — the feature you asked for.
//
// When the user says "send $50 to Sarah" without specifying a method,
// this service automatically picks the best one based on:
//
// Priority order:
//   1. Does the user have enough balance on a service?
//   2. Does the recipient have that service linked?
//   3. If both qualify, prefer PayPal (wider adoption)
//   4. If neither qualifies, surface a clear error explaining why
//
// This is YOUR proprietary logic. No API call — pure business rules.

import { Contact, PaymentMethod, PaymentMethodBalance } from '../store/appStore';

export interface RoutingDecision {
  method: PaymentMethod;
  reason: string;                 // human-readable, shown in confirmation UI
  autoRouted: boolean;
  senderBalance: number;
  recipientEmail: string;
}

export interface RoutingFailure {
  canRoute: false;
  reason: string;                 // explain what's missing so user can fix it
  suggestions: string[];
}

export type RoutingResult = ({ canRoute: true } & RoutingDecision) | RoutingFailure;

// Main entry point — call this when no payment method was specified in voice command
export function routePayment(
  amount: number,
  recipient: Contact,
  senderBalances: PaymentMethodBalance[],
  preferredMethod?: PaymentMethod    // if user said "via PayPal" — bypass auto-routing
): RoutingResult {

  // ── Explicit method requested ──────────────────────────────────
  // User said "via PayPal" or "using Stripe" — respect their choice
  if (preferredMethod) {
    return routeExplicit(amount, recipient, senderBalances, preferredMethod);
  }

  // ── Auto-routing ───────────────────────────────────────────────
  // Determine which methods are viable
  const viable = getViableMethods(amount, recipient, senderBalances);

  if (viable.length === 0) {
    return buildFailure(amount, recipient, senderBalances);
  }

  // Prefer PayPal if available (higher user familiarity, broader adoption)
  const selected = viable.find((v) => v.method === 'paypal') || viable[0];

  return {
    canRoute: true,
    method: selected.method,
    reason: buildAutoReason(selected.method, amount, selected.balance),
    autoRouted: true,
    senderBalance: selected.balance,
    recipientEmail: selected.email,
  };
}

// ── Explicit routing (user specified method) ───────────────────────

function routeExplicit(
  amount: number,
  recipient: Contact,
  senderBalances: PaymentMethodBalance[],
  method: PaymentMethod
): RoutingResult {
  const senderBalance = senderBalances.find((b) => b.method === method);
  const recipientEmail = method === 'paypal' ? recipient.paypalEmail : recipient.stripeEmail;

  if (!senderBalance?.isLinked) {
    return {
      canRoute: false,
      reason: `Your ${label(method)} account is not linked.`,
      suggestions: [`Link your ${label(method)} account in Settings → Payment Methods`],
    };
  }

  if (!recipientEmail) {
    return {
      canRoute: false,
      reason: `${recipient.name} doesn't have a ${label(method)} account on file.`,
      suggestions: [
        `Ask ${recipient.name} for their ${label(method)} email`,
        `Add it in People → ${recipient.name} → Edit`,
        `Try sending via ${otherMethod(method)} instead`,
      ],
    };
  }

  if (senderBalance.balance < amount) {
    return {
      canRoute: false,
      reason: `Insufficient ${label(method)} balance. You have $${senderBalance.balance.toFixed(2)}, need $${amount.toFixed(2)}.`,
      suggestions: [
        `Top up your ${label(method)} balance`,
        `Send $${senderBalance.balance.toFixed(2)} now and the rest later`,
        `Use ${label(otherMethod(method))} instead`,
      ],
    };
  }

  return {
    canRoute: true,
    method,
    reason: `${label(method)} — $${senderBalance.balance.toFixed(2)} available`,
    autoRouted: false,
    senderBalance: senderBalance.balance,
    recipientEmail,
  };
}

// ── Helpers ────────────────────────────────────────────────────────

interface ViableMethod {
  method: PaymentMethod;
  balance: number;
  email: string;
}

function getViableMethods(
  amount: number,
  recipient: Contact,
  senderBalances: PaymentMethodBalance[]
): ViableMethod[] {
  const viable: ViableMethod[] = [];

  for (const balance of senderBalances) {
    if (!balance.isLinked) continue;
    if (balance.balance < amount) continue;

    const recipientEmail =
      balance.method === 'paypal' ? recipient.paypalEmail : recipient.stripeEmail;

    if (!recipientEmail) continue;

    viable.push({
      method: balance.method,
      balance: balance.balance,
      email: recipientEmail,
    });
  }

  return viable;
}

function buildFailure(
  amount: number,
  recipient: Contact,
  senderBalances: PaymentMethodBalance[]
): RoutingFailure {
  const suggestions: string[] = [];

  // Diagnose specifically why routing failed
  for (const balance of senderBalances) {
    if (!balance.isLinked) {
      suggestions.push(`Link your ${label(balance.method)} account in Settings`);
      continue;
    }

    const recipientEmail =
      balance.method === 'paypal' ? recipient.paypalEmail : recipient.stripeEmail;

    if (!recipientEmail) {
      suggestions.push(
        `Add ${recipient.name}'s ${label(balance.method)} email in People tab`
      );
      continue;
    }

    if (balance.balance < amount) {
      suggestions.push(
        `Top up ${label(balance.method)} — you have $${balance.balance.toFixed(2)}, need $${amount.toFixed(2)}`
      );
    }
  }

  return {
    canRoute: false,
    reason: `No payment method can complete this transaction.`,
    suggestions: suggestions.length > 0 ? suggestions : ['Check your payment methods in Settings'],
  };
}

function buildAutoReason(method: PaymentMethod, amount: number, balance: number): string {
  return `Auto-routed via ${label(method)} — $${balance.toFixed(2)} available, sending $${amount.toFixed(2)}`;
}

function label(method: PaymentMethod): string {
  return method === 'paypal' ? 'PayPal' : 'Stripe';
}

function otherMethod(method: PaymentMethod): PaymentMethod {
  return method === 'paypal' ? 'stripe' : 'paypal';
}
