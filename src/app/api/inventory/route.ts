// TOKA GDMS — Inventory Read & Stock Movement API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { isExplicitDemoMode, isSupabaseConfigured } from '@/lib/runtime';

export const dynamic = 'force-dynamic';

const stockActionSchema = z.object({
  operation: z.enum(['receive', 'dispatch']),
  productId: z.string().uuid(),
  fullSheets: z.number().int().min(0),
  halfSheets: z.number().int().min(0),
  locationId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  vehicleLocationId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.fullSheets === 0 && value.halfSheets === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter at least one full or half sheet quantity.' });
  }
  if (value.operation === 'receive' && !value.locationId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['locationId'], message: 'Select a warehouse.' });
  }
  if (value.operation === 'dispatch' && (!value.warehouseId || !value.vehicleLocationId)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['vehicleLocationId'], message: 'Select both a warehouse and a vehicle stock location.' });
  }
});

async function getAuthenticatedOperator() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }) };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role,is_active')
    .eq('id', user.id)
    .single();

  if (error || !profile?.is_active) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Active employee profile required.' }, { status: 403 }) };
  }
  if (!['owner', 'manager'].includes(profile.role)) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Only owners and managers can receive or dispatch stock.' }, { status: 403 }) };
  }
  return { ok: true as const, supabase, user };
}

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      if (isExplicitDemoMode()) return NextResponse.json({ success: true, data: [], simulated: true });
      return NextResponse.json({ success: false, error: 'Supabase is not configured.' }, { status: 503 });
    }

    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });

    const { data, error } = await supabase
      .from('inventory_balances')
      .select(`
        id,
        product_id,
        stock_location_id,
        full_sheets,
        half_sheets,
        fse,
        updated_at,
        products (name, sku, color, thickness_mm),
        stock_locations (name, location_type)
      `)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[INVENTORY API ERROR]', error);
      return NextResponse.json({ success: false, error: 'Unable to load inventory balances.' }, { status: 500 });
    }

    const formatted = (data || []).map((b: any) => ({
      id: b.id,
      productId: b.product_id,
      productName: b.products?.name,
      sku: b.products?.sku,
      color: b.products?.color,
      thicknessMm: b.products?.thickness_mm ? Number(b.products.thickness_mm) : 0,
      stockLocationId: b.stock_location_id,
      locationName: b.stock_locations?.name || 'Unknown Location',
      locationType: b.stock_locations?.location_type || 'warehouse',
      fullSheets: b.full_sheets,
      halfSheets: b.half_sheets,
      fse: Number(b.fse),
      updatedAt: b.updated_at,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error) {
    console.error('[INVENTORY API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to load inventory balances.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        success: false,
        error: 'Stock movements require a connected staging database. Demo mode does not simulate inventory changes.',
      }, { status: 503 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Malformed JSON request.' }, { status: 400 });
    }

    const parsed = stockActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: parsed.error.issues.map((issue) => issue.message).join(' '),
      }, { status: 422 });
    }

    const operator = await getAuthenticatedOperator();
    if (!operator.ok) return operator.response;
    const { supabase } = operator;
    const action = parsed.data;

    const rpcName = action.operation === 'receive' ? 'receive_stock_warehouse' : 'dispatch_stock_vehicle';
    const rpcArgs = action.operation === 'receive'
      ? {
          p_product_id: action.productId,
          p_location_id: action.locationId,
          p_full_sheets: action.fullSheets,
          p_half_sheets: action.halfSheets,
          p_notes: action.notes || null,
        }
      : {
          p_product_id: action.productId,
          p_warehouse_id: action.warehouseId,
          p_vehicle_location_id: action.vehicleLocationId,
          p_full_sheets: action.fullSheets,
          p_half_sheets: action.halfSheets,
          p_notes: action.notes || null,
        };

    const { data, error } = await supabase.rpc(rpcName, rpcArgs);
    if (error) {
      console.error('[INVENTORY MOVEMENT RPC ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('[INVENTORY MOVEMENT API EXCEPTION]', error);
    return NextResponse.json({ success: false, error: 'Unable to record stock movement.' }, { status: 500 });
  }
}
