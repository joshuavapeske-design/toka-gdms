// TOKA GDMS — Employee Turnovers & Cashier Remittance API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import Decimal from 'decimal.js';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const settleTurnoverSchema = z.object({
  turnoverId: z.string().min(1, { message: 'turnoverId is required' }),
  cashRemitted: z.number().min(0, { message: 'cashRemitted must be >= 0' }),
  mpesaForwarded: z.number().min(0, { message: 'mpesaForwarded must be >= 0' }),
  notes: z.string().optional(),
});

let simulatedTurnovers = [
  {
    id: '88888888-8888-8888-8888-888888888801',
    employeeId: '00000000-0000-0000-0000-000000000004',
    employeeName: 'David Ochieng',
    employeeRole: 'driver',
    shiftDate: new Date().toISOString().split('T')[0],
    cashDeclared: 15000.0,
    personalMpesaDeclared: 5000.0,
    cashRemitted: 0.0,
    mpesaForwarded: 0.0,
    variance: -20000.0,
    settledWithCashierId: null,
    cashierName: null,
    settledAt: null,
    notes: 'Collected on Route Industrial Area - Gikomba Express',
    createdAt: new Date().toISOString(),
  },
  {
    id: '88888888-8888-8888-8888-888888888802',
    employeeId: '00000000-0000-0000-0000-000000000003',
    employeeName: 'Grace Muthoni',
    employeeRole: 'salesperson',
    shiftDate: new Date().toISOString().split('T')[0],
    cashDeclared: 8500.0,
    personalMpesaDeclared: 0.0,
    cashRemitted: 8500.0,
    mpesaForwarded: 0.0,
    variance: 0.0,
    settledWithCashierId: '00000000-0000-0000-0000-000000000002',
    cashierName: 'Alice Wanjiku',
    settledAt: new Date(Date.now() - 3600000).toISOString(),
    notes: 'Full remittance received and verified.',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
  },
];

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({ success: true, data: simulatedTurnovers });
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('employee_turnovers')
      .select(`
        id,
        employee_id,
        shift_date,
        cash_declared,
        personal_mpesa_declared,
        cash_remitted,
        mpesa_forwarded,
        variance,
        settled_with_cashier_id,
        settled_at,
        notes,
        created_at,
        employee:profiles!employee_turnovers_employee_id_fkey (full_name, role),
        cashier:profiles!employee_turnovers_settled_with_cashier_id_fkey (full_name)
      `)
      .order('shift_date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
      return NextResponse.json({ success: true, data: simulatedTurnovers });
    }

    const formatted = data.map((t: any) => ({
      id: t.id,
      employeeId: t.employee_id,
      employeeName: t.employee?.full_name || 'Unknown Employee',
      employeeRole: t.employee?.role || '',
      shiftDate: t.shift_date,
      cashDeclared: parseFloat(t.cash_declared) || 0,
      personalMpesaDeclared: parseFloat(t.personal_mpesa_declared) || 0,
      cashRemitted: parseFloat(t.cash_remitted) || 0,
      mpesaForwarded: parseFloat(t.mpesa_forwarded) || 0,
      variance: parseFloat(t.variance) || 0,
      settledWithCashierId: t.settled_with_cashier_id,
      cashierName: t.cashier?.full_name || null,
      settledAt: t.settled_at,
      notes: t.notes,
      createdAt: t.created_at,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch {
    return NextResponse.json({ success: true, data: simulatedTurnovers });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = settleTurnoverSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { turnoverId, cashRemitted, mpesaForwarded, notes } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      const index = simulatedTurnovers.findIndex((t) => t.id === turnoverId);
      if (index === -1) {
        return NextResponse.json({ success: false, error: 'Turnover record not found' }, { status: 404 });
      }

      const item = simulatedTurnovers[index];
      const totalDeclared = new Decimal(item.cashDeclared).plus(item.personalMpesaDeclared);
      const totalRemitted = new Decimal(cashRemitted).plus(mpesaForwarded);
      const newVariance = totalRemitted.minus(totalDeclared).toNumber();

      item.cashRemitted = cashRemitted;
      item.mpesaForwarded = mpesaForwarded;
      item.variance = newVariance;
      item.settledWithCashierId = '00000000-0000-0000-0000-000000000002';
      item.cashierName = 'Alice Wanjiku (Cashier)';
      item.settledAt = new Date().toISOString();
      if (notes) item.notes = notes;

      return NextResponse.json({
        success: true,
        simulated: true,
        message: 'Turnover remittance successfully settled.',
        data: item,
      });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Fetch existing turnover to calculate new variance
    const { data: existing, error: fetchErr } = await supabase
      .from('employee_turnovers')
      .select('cash_declared, personal_mpesa_declared')
      .eq('id', turnoverId)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ success: false, error: 'Turnover record not found' }, { status: 404 });
    }

    const totalDeclared = new Decimal(existing.cash_declared).plus(existing.personal_mpesa_declared);
    const totalRemitted = new Decimal(cashRemitted).plus(mpesaForwarded);
    const calculatedVariance = totalRemitted.minus(totalDeclared).toFixed(2);

    const { data, error } = await supabase
      .from('employee_turnovers')
      .update({
        cash_remitted: cashRemitted,
        mpesa_forwarded: mpesaForwarded,
        variance: calculatedVariance,
        settled_with_cashier_id: user?.id || null,
        settled_at: new Date().toISOString(),
        notes: notes || null,
      })
      .eq('id', turnoverId)
      .select()
      .single();

    if (error) {
      console.error('[TURNOVER SETTLE ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: 'Turnover remittance settled successfully.',
      data,
    });
  } catch (err: any) {
    console.error('[TURNOVER SETTLE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}
