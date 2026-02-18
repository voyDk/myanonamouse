import type { SpendingPlanStep } from '@/features/spending-plan/types';
import { SectionCard } from '@/shared/components/ui/section-card';
import { StatusPill } from '@/shared/components/ui/status-pill';
import { formatPoints } from '@/shared/lib/format';

interface SpendingPlanListProps {
  readonly steps: ReadonlyArray<SpendingPlanStep>;
}

export function SpendingPlanList({ steps }: SpendingPlanListProps) {
  return (
    <SectionCard kicker="Spend Sequence" title="Automation Order">
      <ol className="plan-list">
        {steps.map((step) => (
          <li className="plan-list__item" key={step.id}>
            <div className="plan-list__head">
              <h3>{step.title}</h3>
              <StatusPill status={step.status} />
            </div>
            <p>{step.detail}</p>
            <p className="mono">Estimated Cost: {formatPoints(step.estimatedCost)}</p>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
