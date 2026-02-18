import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@/app/app';
import { AppProvider } from '@/app/providers/app-provider';

const snapshotFixture = {
  bonusPoints: 38758,
  threshold: 98000,
  target: 90000,
  maxCap: 99999,
  donatedToday: false,
  maxDailyDonation: 2000,
  vipWeeksRemaining: 12.6,
  checkedAtIso: '2026-02-18T17:22:25.101Z',
  donationHistory: [
    {
      dateIso: '2026-02-16T21:37:17.000Z',
      amount: 2000,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => snapshotFixture,
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the dashboard shell', async () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>,
    );

    expect(await screen.findByRole('heading', { name: /myanonamouse control room/i })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /dashboard/i })).toBeTruthy();
  });
});
