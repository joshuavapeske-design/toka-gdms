// TOKA GDMS — Customers Directory API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Customer } from '@/types';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

// Default seed customers for development and initial field cache only when DB unconfigured
const DEFAULT_CUSTOMERS: Customer[] = [
  {
    id: '44444444-4444-4444-4444-444444444401',
    accountNumber: 'CUST-001',
    name: 'Apex Glaziers & Aluminum Works',
    primaryPhone: '+254712345678',
    altPhone: '+254722111222',
    deliveryArea: 'Industrial Area, Road C',
    defaultGpsLat: -1.3032,
    defaultGpsLng: 36.8524,
    isCreditEligible: true,
    creditLimit: 250000.0,
    currentBalance: 42000.0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444402',
    accountNumber: 'CUST-002',
    name: 'Nairobi Modern Hardware',
    primaryPhone: '+254723456789',
    deliveryArea: 'Gikomba, Quarry Road',
    defaultGpsLat: -1.2845,
    defaultGpsLng: 36.8378,
    isCreditEligible: true,
    creditLimit: 150000.0,
    currentBalance: 0.0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444403',
    accountNumber: 'CUST-003',
    name: 'Westlands Premium Interiors',
    primaryPhone: '+254734567890',
    deliveryArea: 'Westlands, Muthithi Road',
    defaultGpsLat: -1.2654,
    defaultGpsLng: 36.8045,
    isCreditEligible: false,
    creditLimit: 0.0,
    currentBalance: 0.0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '44444444-4444-4444-4444-444444444404',
    accountNumber: 'CUST-004',
    name: 'Eastleigh Glass & Mirror Centre',
    primaryPhone: '+254745678901',
    deliveryArea: 'Eastleigh, 1st Avenue',
    defaultGpsLat: -1.2789,
    defaultGpsLng: 36.8512,
    isCreditEligible: true,
    creditLimit: 500000.0,
    currentBalance: 120000.0,
    isActive: true,
    createdBy: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export async function GET() {
  try {
    if (isSupabaseConfigured()) {
      const supabase = await createServerSupabaseClient();
      const { data, error } = await supabase
        .from('customers')
        .select(`
          id,
          account_number,
          name,
          primary_phone,
          alt_phone,
          delivery_area,
          default_gps_lat,
          default_gps_lng,
          is_credit_eligible,
          credit_limit,
          is_active,
          created_by,
          created_at,
          updated_at,
          credit_accounts (current_balance)
        `)
        .eq('is_active', true)
        .order('name');

      if (error) {
        console.error('[CUSTOMERS API ERROR]', error);
        return NextResponse.json(
          { success: false, error: `Database error: ${error.message}` },
          { status: 500 }
        );
      }

      const formatted: Customer[] = (data || []).map((c: any) => ({
        id: c.id,
        accountNumber: c.account_number,
        name: c.name,
        primaryPhone: c.primary_phone,
        altPhone: c.alt_phone,
        deliveryArea: c.delivery_area,
        defaultGpsLat: c.default_gps_lat ? parseFloat(c.default_gps_lat) : null,
        defaultGpsLng: c.default_gps_lng ? parseFloat(c.default_gps_lng) : null,
        isCreditEligible: c.is_credit_eligible,
        creditLimit: parseFloat(c.credit_limit || '0'),
        currentBalance: c.credit_accounts?.current_balance == null ? 0 : parseFloat(c.credit_accounts.current_balance),
        isActive: c.is_active,
        createdBy: c.created_by,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }));

      return NextResponse.json({ success: true, data: formatted });
    }

    if (isExplicitDemoMode()) return NextResponse.json({ success: true, data: DEFAULT_CUSTOMERS, simulated: true });
    return NextResponse.json({ success: false, error: 'Supabase is not configured; customer records are unavailable.' }, { status: 503 });
  } catch (err: any) {
    console.error('[CUSTOMERS API EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}


const customerCreateSchema = z.object({
  accountNumber: z.string().trim().min(3).max(30),
  name: z.string().trim().min(2).max(160),
  primaryPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number, e.g. +2547XXXXXXXX.'),
  altPhone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional().or(z.literal('')),
  deliveryArea: z.string().trim().min(2).max(160),
  isCreditEligible: z.boolean(),
  creditLimit: z.number().finite().min(0).max(100000000),
  defaultGpsLat: z.number().finite().min(-90).max(90).optional(),
  defaultGpsLng: z.number().finite().min(-180).max(180).optional(),
}).strict().superRefine((value, context) => {
  if (!value.isCreditEligible && value.creditLimit !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['creditLimit'], message: 'Cash-only customers must have a zero credit limit.' });
  }
  if ((value.defaultGpsLat === undefined) !== (value.defaultGpsLng === undefined)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide both GPS coordinates or leave both blank.' });
  }
});

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ success: false, error: 'Customer creation requires a connected staging database.' }, { status: 503 });
    }

    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ success: false, error: 'Malformed JSON request.' }, { status: 400 }); }

    const parsed = customerCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues.map((issue) => issue.message).join(' ') }, { status: 422 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role,is_active')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.is_active || !['owner', 'manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: 'Only active owners and managers can create customer accounts.' }, { status: 403 });
    }

    const customer = parsed.data;
    const { data, error } = await supabase
      .from('customers')
      .insert({
        account_number: customer.accountNumber,
        name: customer.name,
        primary_phone: customer.primaryPhone,
        alt_phone: customer.altPhone || null,
        delivery_area: customer.deliveryArea,
        is_credit_eligible: customer.isCreditEligible,
        credit_limit: customer.creditLimit,
        default_gps_lat: customer.defaultGpsLat ?? null,
        default_gps_lng: customer.defaultGpsLng ?? null,
        created_by: user.id,
      })
      .select('id,account_number,name,primary_phone,alt_phone,delivery_area,is_credit_eligible,credit_limit,is_active,created_by,created_at,updated_at')
      .single();

    if (error) {
      console.error('[CUSTOMER CREATE ERROR]', error);
      const message = error.code === '23505'
        ? 'That customer account number is already in use.'
        : 'Unable to create the customer account.';
      return NextResponse.json({ success: false, error: message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      data: {
        id: data.id,
        accountNumber: data.account_number,
        name: data.name,
        primaryPhone: data.primary_phone,
        altPhone: data.alt_phone,
        deliveryArea: data.delivery_area,
        defaultGpsLat: data.default_gps_lat,
        defaultGpsLng: data.default_gps_lng,
        isCreditEligible: data.is_credit_eligible,
        creditLimit: Number(data.credit_limit),
        currentBalance: 0,
        isActive: data.is_active,
        createdBy: data.created_by,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('[CUSTOMER CREATE EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to create customer account.' }, { status: 500 });
  }
}
