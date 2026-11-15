// TOKA GDMS — Customers Directory & Management API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Customer } from '@/types';

// Default seed customers for development and initial field cache only when DB unconfigured
let currentCustomers: Customer[] = [
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

function normalizePhone(phone: string): string {
  const cleaned = phone.trim().replace(/[\s-]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('254')) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+254${cleaned.slice(1)}`;
  return `+${cleaned}`;
}

const createCustomerSchema = z.object({
  name: z.string().min(2, { message: 'Customer name is required' }),
  primaryPhone: z.string().min(9, { message: 'Valid phone number is required' }),
  altPhone: z.string().optional(),
  deliveryArea: z.string().min(2, { message: 'Delivery area is required' }),
  isCreditEligible: z.boolean().default(false),
  creditLimit: z.number().min(0, { message: 'Credit limit must be >= 0' }).default(0),
  defaultGpsLat: z.number().optional(),
  defaultGpsLng: z.number().optional(),
});

const updateCustomerCreditSchema = z.object({
  customerId: z.string().min(1, { message: 'customerId is required' }),
  isCreditEligible: z.boolean(),
  creditLimit: z.number().min(0, { message: 'creditLimit must be >= 0' }),
});

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (supabaseUrl && !supabaseUrl.includes('placeholder')) {
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
          credit_accounts (current_balance),
          creator:profiles!customers_created_by_fkey (full_name, role)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

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
        currentBalance: parseFloat(c.credit_accounts?.current_balance || '0'),
        isActive: c.is_active,
        createdBy: c.created_by,
        createdByName: c.creator?.full_name || 'Field Sales Rep',
        createdByRole: c.creator?.role || 'Staff',
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }));

      return NextResponse.json({ success: true, data: formatted });
    }

    // In local sandbox where Supabase is not configured
    return NextResponse.json({ success: true, data: currentCustomers });
  } catch (err: any) {
    console.error('[CUSTOMERS API EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = createCustomerSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const {
      name,
      primaryPhone,
      altPhone,
      deliveryArea,
      isCreditEligible,
      creditLimit,
      defaultGpsLat,
      defaultGpsLng,
    } = parseResult.data;

    const formattedPrimaryPhone = normalizePhone(primaryPhone);
    const formattedAltPhone = altPhone ? normalizePhone(altPhone) : null;

    const phoneRegex = /^\+[1-9]\d{7,14}$/;
    if (!phoneRegex.test(formattedPrimaryPhone)) {
      return NextResponse.json(
        { success: false, error: 'Primary phone must be a valid E.164 phone number (e.g. +254712345678)' },
        { status: 400 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const count = currentCustomers.length + 1;
      const newCustomer: Customer = {
        id: `cust-${Date.now()}`,
        accountNumber: `CUST-${String(count).padStart(3, '0')}`,
        name,
        primaryPhone: formattedPrimaryPhone,
        altPhone: formattedAltPhone || undefined,
        deliveryArea,
        defaultGpsLat: defaultGpsLat ?? null,
        defaultGpsLng: defaultGpsLng ?? null,
        isCreditEligible: isCreditEligible || creditLimit > 0,
        creditLimit: creditLimit || 0,
        currentBalance: 0,
        isActive: true,
        createdBy: 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      currentCustomers.unshift(newCustomer);
      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'Customer registered successfully.',
        data: newCustomer,
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Generate account number
    const { count } = await supabase.from('customers').select('*', { count: 'exact', head: true });
    const accountNumber = `CUST-${String((count || 0) + 1).padStart(3, '0')}`;

    const { data: customer, error: insertErr } = await supabase
      .from('customers')
      .insert({
        account_number: accountNumber,
        name,
        primary_phone: formattedPrimaryPhone,
        alt_phone: formattedAltPhone,
        delivery_area: deliveryArea,
        default_gps_lat: defaultGpsLat ?? null,
        default_gps_lng: defaultGpsLng ?? null,
        is_credit_eligible: isCreditEligible || creditLimit > 0,
        credit_limit: creditLimit || 0,
        created_by: user?.id || '00000000-0000-0000-0000-000000000001',
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[CUSTOMER CREATE ERROR]', insertErr);
      return NextResponse.json({ success: false, error: insertErr.message }, { status: 422 });
    }

    // Initialize credit account
    await supabase.from('credit_accounts').insert({
      customer_id: customer.id,
      current_balance: 0.00,
      total_credit_extended: 0.00,
      total_credit_repaid: 0.00,
    });

    return NextResponse.json({
      success: true,
      message: 'Customer registered successfully.',
      data: {
        id: customer.id,
        accountNumber: customer.account_number,
        name: customer.name,
        primaryPhone: customer.primary_phone,
        altPhone: customer.alt_phone,
        deliveryArea: customer.delivery_area,
        defaultGpsLat: customer.default_gps_lat ? parseFloat(customer.default_gps_lat) : null,
        defaultGpsLng: customer.default_gps_lng ? parseFloat(customer.default_gps_lng) : null,
        isCreditEligible: customer.is_credit_eligible,
        creditLimit: parseFloat(customer.credit_limit || '0'),
        currentBalance: 0,
        isActive: customer.is_active,
        createdBy: customer.created_by,
        createdAt: customer.created_at,
        updatedAt: customer.updated_at,
      },
    });
  } catch (err: any) {
    console.error('[CUSTOMER CREATE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const parseResult = updateCustomerCreditSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { customerId, isCreditEligible, creditLimit } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const index = currentCustomers.findIndex((c) => c.id === customerId);
      if (index === -1) {
        return NextResponse.json({ success: false, error: 'Customer not found' }, { status: 404 });
      }

      currentCustomers[index].isCreditEligible = isCreditEligible;
      currentCustomers[index].creditLimit = creditLimit;
      currentCustomers[index].updatedAt = new Date().toISOString();

      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'Customer credit terms updated successfully.',
        data: currentCustomers[index],
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('customers')
      .update({
        is_credit_eligible: isCreditEligible,
        credit_limit: creditLimit,
        updated_at: new Date().toISOString(),
      })
      .eq('id', customerId)
      .select()
      .single();

    if (error) {
      console.error('[CUSTOMER CREDIT UPDATE ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: 'Customer credit terms updated successfully.',
      data,
    });
  } catch (err: any) {
    console.error('[CUSTOMER CREDIT UPDATE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
