'use client';

import type { ReactNode } from 'react';
import { AuthProvider, type SessionUser } from '@/components/AuthProvider';
import { Navigation } from '@/components/Navigation';
import { SyncStatusBar } from '@/components/SyncStatusBar';

export function AppShell({
  children,
  initialUser,
}: {
  children: ReactNode;
  initialUser: SessionUser;
}) {
  return (
    <AuthProvider initialUser={initialUser}>
      <div className="min-h-screen flex flex-col">
        <SyncStatusBar />
        <Navigation currentRole={initialUser.role} userName={initialUser.fullName} />
        <main className="flex-1 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </AuthProvider>
  );
}

