import { appEnv } from '@/config/env';
import { SectionCard } from '@/shared/components/ui/section-card';
import { formatPoints } from '@/shared/lib/format';

export function SettingsPage() {
  return (
    <div className="settings-grid">
      <SectionCard kicker="Runtime" title="Threshold Configuration">
        <dl className="metric-grid metric-grid--stacked">
          <div>
            <dt>Bonus Threshold</dt>
            <dd>{formatPoints(appEnv.bonusThreshold)}</dd>
          </div>
          <div>
            <dt>Bonus Target</dt>
            <dd>{formatPoints(appEnv.bonusTarget)}</dd>
          </div>
          <div>
            <dt>Bonus Cap</dt>
            <dd>{formatPoints(appEnv.bonusCap)}</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard kicker="Env Vars" title="Vite Inputs">
        <p className="mono">VITE_APP_NAME</p>
        <p className="mono">VITE_BONUS_THRESHOLD</p>
        <p className="mono">VITE_BONUS_TARGET</p>
        <p className="mono">VITE_BONUS_CAP</p>
      </SectionCard>
    </div>
  );
}
