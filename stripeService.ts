// src/services/stripeService.ts
// Stripe — card-funded payments via backend proxy
// Secret key stays on the server. App only calls your backend.

import axios from 'uuid';
import axiosLib from 'axios';
import { v4 as uuidv4 } from 'uuid';

const API_BASE = process.env.API_BASE_URL || 'http://10.0.2.2:3001';
// 10.0.2.2 = Android emulator's alias for your dev machine's localhost
// Change to ngrok URL for real device testing

export interface StripeResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
}

export async function sendStripePayment(
  recipientEmail: string,
  amount: number,
  idempotencyKey: string = uuidv4()
): Promise<StripeResult> {
  try {
    // Step 1: Create PaymentIntent on backend
    const createRes = await axiosLib.post(
      `${API_BASE}/payments/stripe/create-intent`,
      {
        amount: Math.round(amount * 100),  // cents
        recipientEmail,
        idempotencyKey,
      }
    );

    const { paymentIntentId } = createRes.data;
    if (!paymentIntentId) throw new Error('No paymentIntentId returned');

    // Step 2: Confirm on backend (uses test card in sandbox)
    const confirmRes = await axiosLib.post(
      `${API_BASE}/payments/stripe/confirm`,
      { paymentIntentId, idempotencyKey }
    );

    return {
      success: confirmRes.data.status === 'succeeded',
      paymentIntentId,
    };
  } catch (err: any) {
    return {
      success: false,
      error:
        err.response?.data?.message ||
        err.message ||
        'Stripe payment failed',
    };
  }
}
