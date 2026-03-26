// src/services/paypalService.ts
// PayPal REST API v2 — Payouts (sandbox, no partnership required for testing)
// Docs: https://developer.paypal.com/api/rest/

import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

const BASE_URL = 'https://api-m.sandbox.paypal.com';

// IMPORTANT: In production these must go through your backend server.
// For demo/MVP they're here for simplicity. Move to server/ before going live.
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || '';

interface TokenCache {
  token: string;
  expiresAt: number;
}

export interface PayPalResult {
  success: boolean;
  batchId?: string;
  error?: string;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

  const res = await axios.post(
    `${BASE_URL}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${creds}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  tokenCache = {
    token: res.data.access_token,
    expiresAt: Date.now() + (res.data.expires_in - 60) * 1000,
  };

  return tokenCache.token;
}

export async function sendPayPalPayment(
  recipientEmail: string,
  amount: number,
  senderName: string,
  idempotencyKey: string = uuidv4()
): Promise<PayPalResult> {
  try {
    const token = await getAccessToken();

    const res = await axios.post(
      `${BASE_URL}/v1/payments/payouts`,
      {
        sender_batch_header: {
          sender_batch_id: idempotencyKey,
          email_subject: `You received $${amount.toFixed(2)} via VoxPay`,
        },
        items: [
          {
            recipient_type: 'EMAIL',
            amount: { value: amount.toFixed(2), currency: 'USD' },
            receiver: recipientEmail,
            note: `Voice payment from ${senderName} via VoxPay`,
            sender_item_id: `item-${idempotencyKey}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': idempotencyKey,
        },
      }
    );

    return {
      success: true,
      batchId: res.data?.batch_header?.payout_batch_id,
    };
  } catch (err: any) {
    return {
      success: false,
      error:
        err.response?.data?.message ||
        err.response?.data?.error_description ||
        err.message ||
        'PayPal payment failed',
    };
  }
}
