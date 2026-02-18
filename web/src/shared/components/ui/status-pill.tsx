import type { PlanStepStatus } from '@/features/spending-plan/types';

interface StatusPillProps {
  readonly status: PlanStepStatus;
}

const labelByStatus: Record<PlanStepStatus, string> = {
  ready: 'Ready',
  blocked: 'Blocked',
  'not-needed': 'Not Needed',
};

export function StatusPill({ status }: StatusPillProps) {
  return <span className={`status-pill status-pill--${status}`}>{labelByStatus[status]}</span>;
}
