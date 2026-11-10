// TOKA GDMS — Customers Directory API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Customer } from '@/types';

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
          updated_at
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
        currentBalance: 0.0,
        isActive: c.is_active,
        createdBy: c.created_by,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      }));

      return NextResponse.json({ success: true, data: formatted });
    }

    // In local sandbox where Supabase is not configured
    return NextResponse.json({ success: true, data: DEFAULT_CUSTOMERS });
  } catch (err: any) {
    console.error('[CUSTOMERS API EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
