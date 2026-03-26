// src/services/riskEngine.ts
// Rule-based risk scoring — your proprietary IP.
// 0 = no risk, 100 = maximum risk.
// Low (<30) → approve | Medium (30–69) → step-up | High (70+) → block

import { Transaction } from '../store/appStore';

export interface RiskInput {
  amount: number;
  recipientId: string;
  isNewRecipient: boolean;
  voiceConfidence: number;      // 0–1
  userTransactions: Transaction[];
  hourOfDay: number;
  deviceTrusted: boolean;
}

export interface RiskDecision {
  score: number;
  level: 'low' | 'medium' | 'high';
  action: 'approve' | 'stepup' | 'block';
  reasons: string[];
}

export function assessRisk(input: RiskInput): RiskDecision {
  let score = 0;
  const reasons: string[] = [];

  // Rule 1: Amount vs history
  const avg = avgAmount(input.userTransactions);
  const max = maxAmount(input.userTransactions);

  if (input.userTransactions.length === 0) {
    if (input.amount > 100) { score += 20; reasons.push('Large first transaction'); }
  } else {
    if (input.amount > max * 2) { score += 30; reasons.push('Far exceeds your max past transaction'); }
    else if (input.amount > avg * 3) { score += 20; reasons.push('Significantly above your average'); }
    else if (input.amount > avg * 1.5) { score += 10; reasons.push('Above your average amount'); }
  }

  if (input.amount >= 1000) { score += 25; reasons.push('High-value transaction'); }
  else if (input.amount >= 500) { score += 15; reasons.push('Elevated-value transaction'); }

  // Rule 2: New recipient
  if (input.isNewRecipient) {
    score += 15; reasons.push('First payment to this person');
    if (input.amount > 200) { score += 15; reasons.push('High amount to new recipient'); }
  }

  // Rule 3: Voice confidence
  if (input.voiceConfidence < 0.70) { score += 25; reasons.push('Low voice match score'); }
  else if (input.voiceConfidence < 0.80) { score += 10; reasons.push('Moderate voice match score'); }

  // Rule 4: Unusual time
  if (input.hourOfDay >= 1 && input.hourOfDay <= 5) {
    score += 10; reasons.push('Unusual hour (1am–5am)');
  }

  // Rule 5: Device trust
  if (!input.deviceTrusted) { score += 20; reasons.push('Unrecognized device'); }

  // Rule 6: Velocity
  const recentCount = recentTxCount(input.userTransactions, 60);
  if (recentCount >= 5) { score += 25; reasons.push('High transaction velocity'); }
  else if (recentCount >= 3) { score += 10; reasons.push('Elevated transaction frequency'); }

  // Rule 7: Cumulative spend
  const recentSpend = recentTxSpend(input.userTransactions, 60);
  if (recentSpend + input.amount > 2000) {
    score += 20; reasons.push('High cumulative spend this hour');
  }

  score = Math.min(score, 100);
  if (reasons.length === 0) reasons.push('All checks passed');

  const level: RiskDecision['level'] =
    score >= 70 ? 'high' : score >= 30 ? 'medium' : 'low';

  const action: RiskDecision['action'] =
    score >= 70 ? 'block' : score >= 30 ? 'stepup' : 'approve';

  return { score, level, action, reasons };
}

function avgAmount(txs: Transaction[]): number {
  const done = txs.filter((t) => t.status === 'completed');
  return done.length ? done.reduce((s, t) => s + t.amount, 0) / done.length : 50;
}

function maxAmount(txs: Transaction[]): number {
  const done = txs.filter((t) => t.status === 'completed');
  return done.length ? Math.max(...done.map((t) => t.amount)) : 100;
}

function recentTxCount(txs: Transaction[], minutes: number): number {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  return txs.filter((t) => t.createdAt > cutoff && t.status !== 'failed').length;
}

function recentTxSpend(txs: Transaction[], minutes: number): number {
  const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
  return txs
    .filter((t) => t.createdAt > cutoff && t.status === 'completed')
    .reduce((s, t) => s + t.amount, 0);
}
