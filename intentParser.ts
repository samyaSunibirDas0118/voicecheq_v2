// src/services/intentParser.ts
//
// Extracts payment intent from raw voice transcription.
// Pure TypeScript — no ML model, no API, no dependency.
// Handles natural speech patterns for payment commands.
//
// Examples it handles:
//   "send fifty dollars to sarah"                → amount:50, recipient:"sarah", method:null
//   "pay mike thirty five via paypal"            → amount:35, recipient:"mike", method:"paypal"
//   "transfer a hundred bucks to mom using stripe" → amount:100, recipient:"mom", method:"stripe"
//   "send 47.50 to alex"                         → amount:47.50, recipient:"alex", method:null
//   "yes" / "confirm" / "yep"                    → isConfirmation:true
//   "no" / "cancel" / "stop"                     → isCancellation:true

import { PaymentMethod } from '../store/appStore';

export interface ParsedIntent {
  // Payment fields
  amount: number | null;
  recipientName: string | null;
  paymentMethod: PaymentMethod | null;   // null = auto-route

  // Confirmation
  isConfirmation: boolean;
  isCancellation: boolean;

  // Meta
  rawText: string;
  confidence: 'high' | 'medium' | 'low';
  missingFields: string[];
}

// Word-to-number map — covers the common spoken amounts
const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000,
  a: 1,  // "a hundred" = 100
};

const CONFIRM_WORDS = ['yes', 'confirm', 'correct', 'sure', 'yep', 'yeah', 'ok', 'okay', 'proceed', 'send it', 'do it'];
const CANCEL_WORDS = ['no', 'cancel', 'stop', 'abort', 'wait', 'nope', 'never mind', 'nevermind', 'hold on'];
const SEND_VERBS = ['send', 'pay', 'transfer', 'give', 'wire', 'move'];

export function parseIntent(rawText: string): ParsedIntent {
  const text = rawText.toLowerCase().trim();
  const missing: string[] = [];

  const base: ParsedIntent = {
    amount: null,
    recipientName: null,
    paymentMethod: null,
    isConfirmation: false,
    isCancellation: false,
    rawText,
    confidence: 'low',
    missingFields: [],
  };

  // ── Confirmation / cancellation ───────────────────────────────
  if (CONFIRM_WORDS.some((w) => text === w || text.startsWith(w + ' '))) {
    return { ...base, isConfirmation: true, confidence: 'high' };
  }
  if (CANCEL_WORDS.some((w) => text === w || text.startsWith(w + ' '))) {
    return { ...base, isCancellation: true, confidence: 'high' };
  }

  // ── Payment method ─────────────────────────────────────────────
  let paymentMethod: PaymentMethod | null = null;
  if (text.includes('paypal')) paymentMethod = 'paypal';
  else if (text.includes('stripe') || text.includes('card') || text.includes('credit')) {
    paymentMethod = 'stripe';
  }

  // ── Amount ────────────────────────────────────────────────────
  let amount: number | null = null;

  // Numeric: $50, 50, 47.50, 50 dollars
  const numericMatch = text.match(/\$?([\d]+(?:\.[\d]{1,2})?)\s*(?:dollars?|bucks?|usd)?/);
  if (numericMatch) {
    amount = parseFloat(numericMatch[1]);
  }

  // Word-based: "fifty dollars", "twenty five", "a hundred and fifty"
  if (!amount) {
    amount = parseWordAmount(text);
  }

  if (!amount) missing.push('amount');

  // ── Recipient ─────────────────────────────────────────────────
  let recipientName: string | null = null;

  // Strip method qualifiers so they don't get picked up as names
  const cleanText = text
    .replace(/via paypal|using paypal|on paypal|through paypal/g, '')
    .replace(/via stripe|using stripe|on stripe|through stripe/g, '')
    .replace(/via card|using card|using credit/g, '')
    .trim();

  // Pattern: "to [name]" or "for [name]"
  // Captures name between "to/for" and end of string or a qualifier word
  const toMatch = cleanText.match(
    /(?:send|pay|transfer|give|wire|move)?.*?(?:to|for)\s+([a-z]+(?:\s+[a-z]+)??)(?:\s+(?:via|using|with|by|on|through|\d|$)|$)/
  );

  if (toMatch?.[1]) {
    recipientName = capitalize(toMatch[1].trim());
  }

  // Fallback: last word if it's a name (after a send verb)
  if (!recipientName) {
    for (const verb of SEND_VERBS) {
      if (cleanText.startsWith(verb)) {
        const words = cleanText.replace(verb, '').trim().split(/\s+/);
        const lastWord = words[words.length - 1];
        // If last word is not a number or common word, treat as name
        if (lastWord && !WORD_NUMBERS[lastWord] && !/^\d/.test(lastWord)) {
          recipientName = capitalize(lastWord);
        }
        break;
      }
    }
  }

  if (!recipientName) missing.push('recipient');

  // ── Confidence ────────────────────────────────────────────────
  const filledCount = [amount, recipientName].filter(Boolean).length;
  const confidence =
    filledCount === 2 && !missing.length ? 'high' :
    filledCount === 1 ? 'medium' : 'low';

  return {
    ...base,
    amount,
    recipientName,
    paymentMethod,
    confidence,
    missingFields: missing,
  };
}

// ── Word amount parser ─────────────────────────────────────────────

function parseWordAmount(text: string): number | null {
  const words = text.split(/[\s\-]+/);
  let total = 0;
  let current = 0;
  let found = false;

  for (const word of words) {
    const val = WORD_NUMBERS[word];
    if (val === undefined) continue;

    found = true;

    if (val === 1000) {
      total = (total + (current || 1)) * 1000;
      current = 0;
    } else if (val === 100) {
      current = (current || 1) * 100;
    } else {
      current += val;
    }
  }

  if (!found) return null;
  const result = total + current;
  return result > 0 ? result : null;
}

function capitalize(str: string): string {
  return str
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
