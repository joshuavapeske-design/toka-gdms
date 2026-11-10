import { getAuthUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { isExplicitDemoMode } from '@/lib/runtime';
import { redirect } from 'next/navigation';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();

  if (!user && !isExplicitDemoMode()) redirect('/login');
  // Demo identity is available only with explicit local-development opt-in.
  const sessionUser = user
    ? {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
      }
    : {
        id: 'dev-user',
        email: 'dev@toka.co.ke',
        role: 'owner' as const,
        fullName: 'Development User',
        phoneNumber: '+254700000000',
      };

  return <AppShell initialUser={sessionUser}>{children}</AppShell>;
}

