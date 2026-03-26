// src/screens/VoiceScreen.tsx — the demo screen

import React, { useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  SafeAreaView, Animated, Easing, ScrollView,
} from 'react-native';
import { useVoicePayment } from '../hooks/useVoicePayment';
import { useAppStore, Contact } from '../store/appStore';

export default function VoiceScreen({ navigation }: any) {
  const {
    stage, pending, error, transcript,
    ambiguousContacts,
    startVoice, stopAndProcess,
    selectContact,
    confirmPayment, cancelPayment, reset,
  } = useVoicePayment();

  const { user, contacts } = useAppStore();
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  // Pulse animation when listening
  useEffect(() => {
    if (stage === 'listening') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.18, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [stage]);

  // Auto-reset after terminal states
  useEffect(() => {
    if (stage === 'success' || stage === 'cancelled') {
      const t = setTimeout(reset, 3000);
      return () => clearTimeout(t);
    }
  }, [stage]);

  // Quick send contacts (most recent 4)
  const recentContacts = contacts.slice(0, 4);

  // ── Render ─────────────────────────────────────────────────────

  if (stage === 'idle') return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.idleScroll}>
        <Text style={s.greeting}>Hey {user?.name?.split(' ')[0] || 'there'} 👋</Text>
        <Text style={s.tagline}>Speak to send money</Text>

        {/* Balances pill row */}
        <View style={s.balanceRow}>
          {user?.paymentBalances.filter((b) => b.isLinked).map((b) => (
            <View key={b.method} style={s.balancePill}>
              <Text style={s.balancePillLabel}>
                {b.method === 'paypal' ? 'PayPal' : 'Stripe'}
              </Text>
              <Text style={s.balancePillAmount}>${b.balance.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        {/* Quick contacts */}
        {recentContacts.length > 0 && (
          <>
            <Text style={s.sectionLabel}>Quick send</Text>
            <View style={s.quickRow}>
              {recentContacts.map((c) => (
                <TouchableOpacity key={c.id} style={s.quickContact}>
                  <View style={s.avatar}>
                    <Text style={s.avatarText}>{c.avatarInitials || c.name[0]}</Text>
                  </View>
                  <Text style={s.contactName} numberOfLines={1}>{c.name.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Mic button */}
        <TouchableOpacity style={s.micButton} onPress={startVoice} activeOpacity={0.85}>
          <Text style={s.micEmoji}>🎙️</Text>
        </TouchableOpacity>
        <Text style={s.micHint}>Tap and speak</Text>
        <Text style={s.micExample}>"Send fifty dollars to Sarah"</Text>

        <TouchableOpacity style={s.manualLink} onPress={() => navigation.navigate('ManualSend')}>
          <Text style={s.manualLinkText}>Prefer typing? Send manually →</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );

  if (stage === 'listening') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Animated.View style={[s.micButton, s.micActive, { transform: [{ scale: pulseAnim }] }]}>
          <Text style={s.micEmoji}>🔴</Text>
        </Animated.View>
        <Text style={s.listeningLabel}>Listening…</Text>
        {transcript ? (
          <Text style={s.liveTranscript}>"{transcript}"</Text>
        ) : (
          <Text style={s.micHint}>Speak now</Text>
        )}
        <TouchableOpacity style={s.doneButton} onPress={stopAndProcess}>
          <Text style={s.doneButtonText}>Done speaking</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (stage === 'processing') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Text style={s.bigEmoji}>⚡</Text>
        <Text style={s.statusText}>Processing…</Text>
        {transcript ? <Text style={s.liveTranscript}>"{transcript}"</Text> : null}
      </View>
    </SafeAreaView>
  );

  // Disambiguation — multiple contacts matched
  if (stage === 'disambiguating') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Text style={s.confirmTitle}>Which person?</Text>
        <Text style={s.disambigHint}>Multiple contacts matched. Tap to select.</Text>
        {ambiguousContacts.map((c) => (
          <TouchableOpacity key={c.id} style={s.disambigOption} onPress={() => selectContact(c)}>
            <View style={s.avatar}><Text style={s.avatarText}>{c.avatarInitials || c.name[0]}</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={s.disambigName}>{c.name}</Text>
              <Text style={s.disambigSub}>
                {[c.paypalEmail && 'PayPal', c.stripeEmail && 'Stripe'].filter(Boolean).join(' · ')}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.cancelLink} onPress={reset}>
          <Text style={s.cancelLinkText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (stage === 'confirming' || stage === 'stepup') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        {stage === 'stepup' && (
          <View style={s.stepupBanner}>
            <Text style={s.stepupText}>⚠️ Extra confirmation required</Text>
            <Text style={s.stepupReason}>{pending?.risk.reasons[0]}</Text>
          </View>
        )}

        <Text style={s.confirmTitle}>Confirm payment</Text>

        <View style={s.confirmCard}>
          <Text style={s.confirmAmount}>${pending?.amount.toFixed(2)}</Text>
          <Text style={s.confirmTo}>to {pending?.recipient.name}</Text>

          {/* Routing info — KEY differentiator to show YC */}
          <View style={s.routingBadge}>
            <Text style={s.routingBadgeText}>
              {pending?.autoRouted ? '⚡ Auto-routed' : '📌 Requested'} via{' '}
              {pending?.routing.method === 'paypal' ? 'PayPal' : 'Stripe'}
            </Text>
          </View>
          {pending?.autoRouted && (
            <Text style={s.routingReason}>{pending.routing.reason}</Text>
          )}

          <Text style={s.voiceScore}>
            🎙️ Voice match: {(pending ? pending.voiceScore * 100 : 0).toFixed(0)}%
          </Text>
        </View>

        <View style={s.confirmButtons}>
          <TouchableOpacity style={s.cancelButton} onPress={cancelPayment}>
            <Text style={s.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.sendButton} onPress={confirmPayment}>
            <Text style={s.sendButtonText}>
              {stage === 'stepup' ? 'Confirm anyway →' : 'Send →'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );

  if (stage === 'executing') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Text style={s.bigEmoji}>💸</Text>
        <Text style={s.statusText}>Sending…</Text>
      </View>
    </SafeAreaView>
  );

  if (stage === 'success') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Text style={s.bigEmoji}>✅</Text>
        <Text style={[s.statusText, { color: '#00B894' }]}>Sent!</Text>
        {pending && (
          <>
            <Text style={s.successDetail}>
              ${pending.amount.toFixed(2)} → {pending.recipient.name}
            </Text>
            <Text style={s.successMethod}>
              via {pending.routing.method === 'paypal' ? 'PayPal' : 'Stripe'}
              {pending.autoRouted ? ' (auto-selected)' : ''}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );

  if (stage === 'failed') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Text style={s.bigEmoji}>⚠️</Text>
        <Text style={s.errorText}>{error || 'Something went wrong'}</Text>
        <TouchableOpacity style={s.retryButton} onPress={reset}>
          <Text style={s.retryButtonText}>Try again</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.manualLink} onPress={() => navigation.navigate('ManualSend')}>
          <Text style={s.manualLinkText}>Send manually →</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  if (stage === 'cancelled') return (
    <SafeAreaView style={s.container}>
      <View style={s.centered}>
        <Text style={s.bigEmoji}>🚫</Text>
        <Text style={s.statusText}>Cancelled</Text>
      </View>
    </SafeAreaView>
  );

  return null;
}

const PURPLE = '#6C5CE7';
const BG = '#0F0F1A';
const CARD = '#1A1A2E';
const BORDER = '#2A2A4F';
const TEXT = '#FFFFFF';
const MUTED = '#A0A0B8';
const DIM = '#606080';

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  idleScroll: { alignItems: 'center', paddingTop: 48, paddingHorizontal: 24, paddingBottom: 32 },

  greeting: { fontSize: 22, color: TEXT, fontWeight: '700', marginBottom: 4 },
  tagline: { fontSize: 15, color: MUTED, marginBottom: 24 },

  balanceRow: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  balancePill: {
    backgroundColor: CARD, borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center',
  },
  balancePillLabel: { fontSize: 11, color: MUTED, marginBottom: 2 },
  balancePillAmount: { fontSize: 17, color: TEXT, fontWeight: '700' },

  sectionLabel: { fontSize: 12, color: DIM, alignSelf: 'flex-start', marginBottom: 12 },
  quickRow: { flexDirection: 'row', gap: 20, marginBottom: 40 },
  quickContact: { alignItems: 'center', gap: 6, width: 60 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#2A2A4F', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, color: TEXT, fontWeight: '700' },
  contactName: { fontSize: 12, color: MUTED, textAlign: 'center' },

  micButton: {
    width: 100, height: 100, borderRadius: 50, backgroundColor: PURPLE,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
    elevation: 12,
  },
  micActive: { backgroundColor: '#E84393' },
  micEmoji: { fontSize: 44 },
  micHint: { fontSize: 14, color: DIM, marginBottom: 4 },
  micExample: { fontSize: 13, color: '#3A3A6F', fontStyle: 'italic', marginBottom: 32 },
  manualLink: { marginTop: 8 },
  manualLinkText: { fontSize: 14, color: PURPLE },

  listeningLabel: { fontSize: 24, color: TEXT, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  liveTranscript: { fontSize: 15, color: MUTED, fontStyle: 'italic', textAlign: 'center', marginBottom: 32, lineHeight: 22 },
  doneButton: { backgroundColor: CARD, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 24, borderWidth: 1, borderColor: BORDER },
  doneButtonText: { color: TEXT, fontSize: 16 },

  bigEmoji: { fontSize: 72, marginBottom: 16 },
  statusText: { fontSize: 26, color: TEXT, fontWeight: '700' },

  // Disambiguation
  confirmTitle: { fontSize: 22, color: TEXT, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
  disambigHint: { fontSize: 14, color: MUTED, marginBottom: 20, textAlign: 'center' },
  disambigOption: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    width: '100%', backgroundColor: CARD, borderRadius: 14,
    padding: 14, marginBottom: 10, borderWidth: 1, borderColor: BORDER,
  },
  disambigName: { fontSize: 16, color: TEXT, fontWeight: '600' },
  disambigSub: { fontSize: 12, color: MUTED, marginTop: 2 },
  cancelLink: { marginTop: 12 },
  cancelLinkText: { color: DIM, fontSize: 15 },

  // Confirmation
  stepupBanner: {
    backgroundColor: '#2D2000', borderRadius: 12, padding: 14,
    marginBottom: 16, width: '100%', borderWidth: 1, borderColor: '#5D4000',
  },
  stepupText: { fontSize: 15, color: '#FDCB6E', fontWeight: '700' },
  stepupReason: { fontSize: 13, color: '#A08040', marginTop: 4 },

  confirmCard: {
    width: '100%', backgroundColor: CARD, borderRadius: 20,
    padding: 28, alignItems: 'center', marginBottom: 24,
    borderWidth: 1, borderColor: BORDER,
  },
  confirmAmount: { fontSize: 52, color: TEXT, fontWeight: '800' },
  confirmTo: { fontSize: 18, color: MUTED, marginTop: 4, marginBottom: 14 },
  routingBadge: { backgroundColor: '#1A1A3A', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, marginBottom: 6 },
  routingBadgeText: { color: '#A29BFE', fontSize: 13 },
  routingReason: { fontSize: 11, color: DIM, textAlign: 'center', marginBottom: 8 },
  voiceScore: { fontSize: 12, color: DIM, marginTop: 4 },

  confirmButtons: { flexDirection: 'row', gap: 14, width: '100%' },
  cancelButton: { flex: 1, backgroundColor: CARD, paddingVertical: 16, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  cancelButtonText: { color: MUTED, fontSize: 17 },
  sendButton: { flex: 1, backgroundColor: PURPLE, paddingVertical: 16, borderRadius: 16, alignItems: 'center' },
  sendButtonText: { color: TEXT, fontSize: 17, fontWeight: '700' },

  successDetail: { fontSize: 18, color: MUTED, marginTop: 8 },
  successMethod: { fontSize: 13, color: DIM, marginTop: 4 },

  errorText: { fontSize: 16, color: '#FF7675', textAlign: 'center', lineHeight: 24, marginBottom: 28 },
  retryButton: { backgroundColor: PURPLE, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 24, marginBottom: 14 },
  retryButtonText: { color: TEXT, fontSize: 16, fontWeight: '600' },
});
