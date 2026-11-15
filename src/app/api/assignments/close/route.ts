// TOKA GDMS — Close Vehicle Shift Assignment API
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const closeAssignmentSchema = z.object({
  assignmentId: z.string().min(1, { message: 'assignmentId is required' }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parseResult = closeAssignmentSchema.safeParse(body);

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => e.message).join('; ');
      return NextResponse.json({ success: false, error: errorMsg }, { status: 400 });
    }

    const { assignmentId } = parseResult.data;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('placeholder')) {
      return NextResponse.json({
        success: true,
        simulated: true,
        message: `Vehicle shift assignment ${assignmentId} closed successfully.`,
        data: {
          id: assignmentId,
          isActive: false,
          endedAt: new Date().toISOString(),
        },
      });
    }

    const supabase = await createServerSupabaseClient();
    const endedAt = new Date().toISOString();

    const { data, error } = await supabase
      .from('vehicle_assignments')
      .update({
        is_active: false,
        ended_at: endedAt,
      })
      .eq('id', assignmentId)
      .select('id, shift_date, started_at, ended_at, is_active')
      .single();

    if (error) {
      console.error('[ASSIGNMENT CLOSE ERROR]', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: 'Vehicle shift successfully ended.',
      data,
    });
  } catch (err: any) {
    console.error('[ASSIGNMENT CLOSE EXCEPTION]', err);
    return NextResponse.json({ success: false, error: err.message || 'Internal server error' }, { status: 500 });
  }
}

