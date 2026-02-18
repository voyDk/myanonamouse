import type { BonusSnapshot } from '@/features/bonus/types';
import type { SpendingPlanStep } from '@/features/spending-plan/types';

const VIP_COSTS = {
  fourWeeks: 5000,
  eightWeeks: 10000,
  twelveWeeks: 15000,
} as const;

const UPLOAD_MIN_COST = 500;

const maxAffordableVipSpend = (remainingPoints: number): number => {
  if (remainingPoints >= VIP_COSTS.twelveWeeks) {
    return VIP_COSTS.twelveWeeks;
  }

  if (remainingPoints >= VIP_COSTS.eightWeeks) {
    return VIP_COSTS.eightWeeks;
  }

  if (remainingPoints >= VIP_COSTS.fourWeeks) {
    return VIP_COSTS.fourWeeks;
  }

  return 0;
};

export function buildSpendingPlan(snapshot: BonusSnapshot): ReadonlyArray<SpendingPlanStep> {
  const overflow = Math.max(0, snapshot.bonusPoints - snapshot.target);

  const donationCost = Math.min(overflow, snapshot.maxDailyDonation);
  const donationStep: SpendingPlanStep = snapshot.donatedToday
    ? {
        id: 'donation',
        kind: 'donate',
        title: "Millionaire's Club",
        detail: 'Already donated for the current day.',
        status: 'blocked',
        estimatedCost: 0,
      }
    : overflow <= 0
      ? {
          id: 'donation',
          kind: 'donate',
          title: "Millionaire's Club",
          detail: 'No bonus overflow to reduce.',
          status: 'not-needed',
          estimatedCost: 0,
        }
      : {
          id: 'donation',
          kind: 'donate',
          title: "Millionaire's Club",
          detail: `Donate up to ${snapshot.maxDailyDonation.toLocaleString()} points today.`,
          status: 'ready',
          estimatedCost: donationCost,
        };

  const remainingAfterDonation =
    donationStep.status === 'ready' ? Math.max(0, overflow - donationStep.estimatedCost) : overflow;

  const vipSpend = maxAffordableVipSpend(remainingAfterDonation);
  const vipStep: SpendingPlanStep = snapshot.vipWeeksRemaining >= 12.8
    ? {
        id: 'vip',
        kind: 'vip',
        title: 'VIP Extension',
        detail: 'VIP time is already at the 12.8 week cap.',
        status: 'blocked',
        estimatedCost: 0,
      }
    : remainingAfterDonation <= 0
      ? {
          id: 'vip',
          kind: 'vip',
          title: 'VIP Extension',
          detail: 'No overflow remains after donation.',
          status: 'not-needed',
          estimatedCost: 0,
        }
      : vipSpend > 0
        ? {
            id: 'vip',
            kind: 'vip',
            title: 'VIP Extension',
            detail: 'Buy 4/8/12 weeks or use Max me out based on available points.',
            status: 'ready',
            estimatedCost: vipSpend,
          }
        : {
            id: 'vip',
            kind: 'vip',
            title: 'VIP Extension',
            detail: 'Need at least 5,000 points to buy a fixed VIP block.',
            status: 'blocked',
            estimatedCost: 0,
          };

  const remainingAfterVip =
    vipStep.status === 'ready' ? Math.max(0, remainingAfterDonation - vipStep.estimatedCost) : remainingAfterDonation;

  const uploadSpend = Math.floor(remainingAfterVip / UPLOAD_MIN_COST) * UPLOAD_MIN_COST;
  const uploadStep: SpendingPlanStep = remainingAfterVip < UPLOAD_MIN_COST
    ? {
        id: 'upload',
        kind: 'upload',
        title: 'Upload Credit',
        detail: 'Leftover is below the minimum 500-point exchange.',
        status: remainingAfterVip === 0 ? 'not-needed' : 'blocked',
        estimatedCost: 0,
      }
    : {
        id: 'upload',
        kind: 'upload',
        title: 'Upload Credit',
        detail: 'Exchange remaining points into upload credit blocks.',
        status: 'ready',
        estimatedCost: uploadSpend,
      };

  return [donationStep, vipStep, uploadStep];
}
