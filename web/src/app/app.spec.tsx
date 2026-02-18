import { render, screen } from '@testing-library/react';

import App from '@/app/app';
import { AppProvider } from '@/app/providers/app-provider';

describe('App', () => {
  it('renders the dashboard shell', () => {
    render(
      <AppProvider>
        <App />
      </AppProvider>,
    );

    expect(screen.getByRole('heading', { name: /myanonamouse control room/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /dashboard/i })).toBeTruthy();
  });
});
