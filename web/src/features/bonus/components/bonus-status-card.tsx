import type { BonusSnapshot } from '@/features/bonus/types';
import { SectionCard } from '@/shared/components/ui/section-card';
import { formatPoints, formatWeeks } from '@/shared/lib/format';

interface BonusStatusCardProps {
  readonly snapshot: BonusSnapshot;
}

export function BonusStatusCard({ snapshot }: BonusStatusCardProps) {
  const utilization = Math.min(100, (snapshot.bonusPoints / snapshot.maxCap) * 100);
  const overflow = Math.max(0, snapshot.bonusPoints - snapshot.target);

  return (
    <SectionCard
      kicker="Current Balance"
      title={formatPoints(snapshot.bonusPoints)}
      actions={<span className="mono">Cap {formatPoints(snapshot.maxCap)}</span>}
    >
      <div className="meter">
        <div className="meter__fill" style={{ width: `${utilization}%` }} />
      </div>
      <dl className="metric-grid">
        <div>
          <dt>Threshold</dt>
          <dd>{formatPoints(snapshot.threshold)}</dd>
        </div>
        <div>
          <dt>Target</dt>
          <dd>{formatPoints(snapshot.target)}</dd>
        </div>
        <div>
          <dt>Overflow</dt>
          <dd>{formatPoints(overflow)}</dd>
        </div>
        <div>
          <dt>VIP Remaining</dt>
          <dd>{formatWeeks(snapshot.vipWeeksRemaining)}</dd>
        </div>
      </dl>
    </SectionCard>
  );
}
