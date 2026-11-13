import { getAuthUser } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';

export const dynamic = 'force-dynamic';

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getAuthUser();

  // If no real Supabase, provide a demo user for development
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

