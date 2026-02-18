export type PlanStepKind = 'donate' | 'vip' | 'upload';

export type PlanStepStatus = 'ready' | 'blocked' | 'not-needed';

export interface SpendingPlanStep {
  readonly id: string;
  readonly kind: PlanStepKind;
  readonly title: string;
  readonly detail: string;
  readonly status: PlanStepStatus;
  readonly estimatedCost: number;
}
