// TOKA GDMS — Server-Side Auth Helpers

import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { UserRole, Profile } from '@/types';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  phoneNumber: string;
  isActive: boolean;
}

/**
 * Gets the current authenticated user with their profile.
 * Returns null if not authenticated or profile is missing/inactive.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, phone_number, role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  return {
    id: profile.id,
    email: user.email || '',
    role: profile.role as UserRole,
    fullName: profile.full_name,
    phoneNumber: profile.phone_number,
    isActive: profile.is_active,
  };
}

/**
 * Checks whether the current user's role is in the allowed list.
 * Use in server actions and API routes to enforce authorization.
 */
export async function requireRole(...allowedRoles: UserRole[]): Promise<AuthUser> {
  const user = await getAuthUser();

  if (!user) {
    throw new Error('Authentication required');
  }

  if (!allowedRoles.includes(user.role)) {
    throw new Error(`Access denied. Required role: ${allowedRoles.join(' or ')}`);
  }

  return user;
}

