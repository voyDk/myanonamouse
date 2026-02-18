import { appEnv } from '@/config/env';
import type { BonusSnapshot } from '@/features/bonus/types';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const asNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
};

const asBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }
    if (value.toLowerCase() === 'false') {
      return false;
    }
  }
  return fallback;
};

const normalizeDonationHistory = (value: unknown): BonusSnapshot['donationHistory'] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }
      const dateIsoRaw = entry.dateIso;
      const amountRaw = entry.amount;
      if (typeof dateIsoRaw !== 'string') {
        return null;
      }
      const amount = asNumber(amountRaw, 0);
      return {
        dateIso: dateIsoRaw,
        amount,
      };
    })
    .filter((entry): entry is BonusSnapshot['donationHistory'][number] => entry !== null);
};

const normalizeSnapshot = (value: unknown): BonusSnapshot => {
  if (!isRecord(value)) {
    throw new Error('Snapshot payload is not an object.');
  }

  const checkedAtIsoRaw = value.checkedAtIso;
  const checkedAtIso = typeof checkedAtIsoRaw === 'string' ? checkedAtIsoRaw : new Date().toISOString();

  return {
    bonusPoints: asNumber(value.bonusPoints),
    threshold: asNumber(value.threshold, appEnv.bonusThreshold),
    target: asNumber(value.target, appEnv.bonusTarget),
    maxCap: asNumber(value.maxCap, appEnv.bonusCap),
    donatedToday: asBoolean(value.donatedToday),
    maxDailyDonation: asNumber(value.maxDailyDonation, 2000),
    vipWeeksRemaining: asNumber(value.vipWeeksRemaining, 0),
    checkedAtIso,
    donationHistory: normalizeDonationHistory(value.donationHistory),
  };
};

interface GetBonusSnapshotOptions {
  readonly forceRefresh?: boolean;
}

export async function getBonusSnapshot(options: GetBonusSnapshotOptions = {}): Promise<BonusSnapshot> {
  const endpoint = options.forceRefresh ? '/api/snapshot?refresh=1' : '/api/snapshot';
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const raw = (await response.json()) as unknown;

  if (!response.ok) {
    const message = isRecord(raw) && typeof raw.error === 'string' ? raw.error : 'Live snapshot request failed.';
    throw new Error(message);
  }

  return normalizeSnapshot(raw);
}
