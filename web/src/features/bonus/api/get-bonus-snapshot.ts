import { appEnv } from '@/config/env';
import type { BonusSnapshot } from '@/features/bonus/types';

const DEMO_DELAY_MS = 180;

const baseSnapshot: Omit<BonusSnapshot, 'threshold' | 'target' | 'maxCap' | 'checkedAtIso'> = {
  bonusPoints: 38758,
  donatedToday: true,
  maxDailyDonation: 2000,
  vipWeeksRemaining: 12.6,
  donationHistory: [
    {
      dateIso: '2026-02-16T21:37:17Z',
      amount: 2000,
    },
  ],
};

export async function getBonusSnapshot(): Promise<BonusSnapshot> {
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), DEMO_DELAY_MS);
  });

  return {
    ...baseSnapshot,
    threshold: appEnv.bonusThreshold,
    target: appEnv.bonusTarget,
    maxCap: appEnv.bonusCap,
    checkedAtIso: new Date().toISOString(),
  };
}
