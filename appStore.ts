// src/store/appStore.ts
// Global state management — Zustand v5
// Everything lives here for MVP. See docs/SCALING.md for database strategy.

import { create } from 'zustand';

// ── Types ──────────────────────────────────────────────────────────

export type PaymentMethod = 'paypal' | 'stripe';

export interface PaymentMethodBalance {
  method: PaymentMethod;
  balance: number;       // USD — what the user has available on this service
  accountId: string;     // PayPal email or Stripe customer ID
  isLinked: boolean;
}

// A contact can have PayPal, Stripe, or both
// Smart routing checks which services BOTH the sender and recipient share
export interface Contact {
  id: string;
  name: string;
  paypalEmail?: string;   // if set, PayPal transfers work
  stripeEmail?: string;   // if set, Stripe transfers work
  avatarInitials?: string;
  lastTransactionAt?: string;
}

export interface Transaction {
  id: string;
  amount: number;
  currency: string;
  recipientId: string;
  recipientName: string;
  paymentMethod: PaymentMethod;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  voiceConfidence: number;   // 0–1 from voice verification
  riskScore: number;         // 0–100 from risk engine
  createdAt: string;
  idempotencyKey: string;
  autoRouted: boolean;       // true = system picked the method automatically
  routingReason?: string;    // why this method was chosen
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  isVoiceEnrolled: boolean;
  enrolledAt?: string;
  paymentBalances: PaymentMethodBalance[];
}

interface AppState {
  user: UserProfile | null;
  contacts: Contact[];
  transactions: Transaction[];
  isListening: boolean;
  isProcessing: boolean;
  lastError: string | null;

  // User actions
  setUser: (u: UserProfile) => void;
  setVoiceEnrolled: (enrolled: boolean) => void;
  updateBalance: (method: PaymentMethod, balance: number) => void;

  // Contact actions
  setContacts: (contacts: Contact[]) => void;
  addContact: (c: Contact) => void;
  updateContact: (id: string, updates: Partial<Contact>) => void;
  removeContact: (id: string) => void;

  // Transaction actions
  addTransaction: (tx: Transaction) => void;
  updateTransaction: (id: string, updates: Partial<Transaction>) => void;

  // UI state
  setListening: (v: boolean) => void;
  setProcessing: (v: boolean) => void;
  setError: (msg: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  contacts: [],
  transactions: [],
  isListening: false,
  isProcessing: false,
  lastError: null,

  setUser: (user) => set({ user }),

  setVoiceEnrolled: (enrolled) =>
    set((s) => ({
      user: s.user
        ? { ...s.user, isVoiceEnrolled: enrolled, enrolledAt: new Date().toISOString() }
        : null,
    })),

  updateBalance: (method, balance) =>
    set((s) => ({
      user: s.user
        ? {
            ...s.user,
            paymentBalances: s.user.paymentBalances.map((b) =>
              b.method === method ? { ...b, balance } : b
            ),
          }
        : null,
    })),

  setContacts: (contacts) => set({ contacts }),
  addContact: (c) => set((s) => ({ contacts: [...s.contacts, c] })),
  updateContact: (id, updates) =>
    set((s) => ({
      contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  removeContact: (id) =>
    set((s) => ({ contacts: s.contacts.filter((c) => c.id !== id) })),

  addTransaction: (tx) =>
    set((s) => ({ transactions: [tx, ...s.transactions] })),
  updateTransaction: (id, updates) =>
    set((s) => ({
      transactions: s.transactions.map((tx) =>
        tx.id === id ? { ...tx, ...updates } : tx
      ),
    })),

  setListening: (v) => set({ isListening: v }),
  setProcessing: (v) => set({ isProcessing: v }),
  setError: (msg) => set({ lastError: msg }),
}));
