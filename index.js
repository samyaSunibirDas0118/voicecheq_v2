// server/index.js
// VoxPay backend — handles Stripe secret key operations
// Run: node index.js
// Uses 10.0.2.2 for Android emulator → localhost mapping

const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
require('dotenv').config({ path: '../.env' });

const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? 'SANDBOX' : 'LIVE';
  res.json({ status: 'ok', mode, timestamp: new Date().toISOString() });
});

// Create Stripe PaymentIntent
app.post('/payments/stripe/create-intent', async (req, res) => {
  const { amount, recipientEmail, idempotencyKey } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ message: 'Invalid amount' });
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: Math.round(amount),      // in cents, already converted by client
        currency: 'usd',
        receipt_email: recipientEmail,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { source: 'voxpay_voice_auth', recipient: recipientEmail },
      },
      { idempotencyKey: `create-${idempotencyKey}` }
    );

    res.json({
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
    });
  } catch (err) {
    console.error('[Stripe] create-intent error:', err.message);
    res.status(400).json({ message: err.message });
  }
});

// Confirm Stripe PaymentIntent (uses test card in sandbox)
app.post('/payments/stripe/confirm', async (req, res) => {
  const { paymentIntentId, idempotencyKey } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json({ message: 'paymentIntentId required' });
  }

  try {
    const intent = await stripe.paymentIntents.confirm(
      paymentIntentId,
      {
        payment_method: 'pm_card_visa',   // Stripe sandbox test card — always succeeds
        return_url: 'voxpay://return',
      },
      { idempotencyKey: `confirm-${idempotencyKey}` }
    );

    res.json({ status: intent.status, paymentIntentId: intent.id });
  } catch (err) {
    console.error('[Stripe] confirm error:', err.message);
    res.status(400).json({ message: err.message });
  }
});

// Get PaymentIntent status
app.get('/payments/stripe/status/:id', async (req, res) => {
  try {
    const intent = await stripe.paymentIntents.retrieve(req.params.id);
    res.json({ status: intent.status });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  const mode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test') ? '✅ SANDBOX' : '⚠️  LIVE';
  console.log(`\n🚀 VoxPay backend on http://localhost:${PORT}`);
  console.log(`   Stripe mode: ${mode}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);
});
