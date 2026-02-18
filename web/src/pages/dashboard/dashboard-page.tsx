import { BonusStatusCard } from '@/features/bonus/components/bonus-status-card';
import { useBonusSnapshot } from '@/features/bonus/hooks/use-bonus-snapshot';
import { SpendingPlanList } from '@/features/spending-plan/components/spending-plan-list';
import { buildSpendingPlan } from '@/features/spending-plan/lib/build-spending-plan';
import { SectionCard } from '@/shared/components/ui/section-card';
import { formatDateTime, formatPoints } from '@/shared/lib/format';

export function DashboardPage() {
  const { state, refresh } = useBonusSnapshot();

  if (state.status === 'loading') {
    return (
      <SectionCard kicker="Live Check" title="Loading snapshot">
        <p>Collecting the latest bonus, VIP, and donation state from your account.</p>
      </SectionCard>
    );
  }

  if (state.status === 'error') {
    return (
      <SectionCard
        kicker="Connection"
        title="Snapshot unavailable"
        actions={
          <button className="btn" onClick={refresh} type="button">
            Retry
          </button>
        }
      >
        <p>{state.error}</p>
      </SectionCard>
    );
  }

  const snapshot = state.data;
  const steps = buildSpendingPlan(snapshot);

  return (
    <div className="dashboard-grid">
      <BonusStatusCard snapshot={snapshot} />
      <SpendingPlanList steps={steps} />

      <SectionCard
        kicker="Donation Log"
        title="Millionaire's Club History"
        actions={<span className="mono">Daily Max {formatPoints(snapshot.maxDailyDonation)}</span>}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.donationHistory.length === 0 ? (
                <tr>
                  <td colSpan={2}>No donation rows yet.</td>
                </tr>
              ) : (
                snapshot.donationHistory.map((entry) => (
                  <tr key={entry.dateIso}>
                    <td>{formatDateTime(entry.dateIso)}</td>
                    <td>{formatPoints(entry.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="subtle">Last refreshed at {formatDateTime(snapshot.checkedAtIso)}.</p>
      </SectionCard>
    </div>
  );
}
