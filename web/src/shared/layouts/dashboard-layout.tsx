import { NavLink, Outlet } from 'react-router-dom';

import { appEnv } from '@/config/env';

const navClass = ({ isActive }: { isActive: boolean }): string =>
  isActive ? 'shell-nav__link shell-nav__link--active' : 'shell-nav__link';

export function DashboardLayout() {
  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div>
          <p className="eyebrow">Bonus Guardrail</p>
          <h1>{appEnv.appName}</h1>
        </div>
        <nav className="shell-nav" aria-label="Primary">
          <NavLink className={navClass} to="/" end>
            Dashboard
          </NavLink>
          <NavLink className={navClass} to="/settings">
            Settings
          </NavLink>
        </nav>
      </header>
      <main className="app-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
