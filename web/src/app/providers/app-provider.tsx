import { type PropsWithChildren } from 'react';
import { BrowserRouter } from 'react-router-dom';

export function AppProvider({ children }: PropsWithChildren) {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      {children}
    </BrowserRouter>
  );
}
