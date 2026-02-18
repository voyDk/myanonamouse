export interface DonationRecord {
  readonly dateIso: string;
  readonly amount: number;
}

export interface BonusSnapshot {
  readonly bonusPoints: number;
  readonly threshold: number;
  readonly target: number;
  readonly maxCap: number;
  readonly donatedToday: boolean;
  readonly maxDailyDonation: number;
  readonly vipWeeksRemaining: number;
  readonly checkedAtIso: string;
  readonly donationHistory: ReadonlyArray<DonationRecord>;
}
