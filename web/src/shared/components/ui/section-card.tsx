import type { PropsWithChildren, ReactNode } from 'react';

interface SectionCardProps extends PropsWithChildren {
  readonly title: string;
  readonly kicker?: string;
  readonly actions?: ReactNode;
}

export function SectionCard({ title, kicker, actions, children }: SectionCardProps) {
  return (
    <section className="section-card">
      <header className="section-card__header">
        <div>
          {kicker ? <p className="section-card__kicker">{kicker}</p> : null}
          <h2 className="section-card__title">{title}</h2>
        </div>
        {actions ? <div className="section-card__actions">{actions}</div> : null}
      </header>
      <div className="section-card__body">{children}</div>
    </section>
  );
}
