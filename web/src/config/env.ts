const parseNumber = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const appEnv = {
  appName: import.meta.env.VITE_APP_NAME ?? 'MyAnonamouse Control Room',
  bonusThreshold: parseNumber(import.meta.env.VITE_BONUS_THRESHOLD, 98000),
  bonusTarget: parseNumber(import.meta.env.VITE_BONUS_TARGET, 90000),
  bonusCap: parseNumber(import.meta.env.VITE_BONUS_CAP, 99999),
} as const;
