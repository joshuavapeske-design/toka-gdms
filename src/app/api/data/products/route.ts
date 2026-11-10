// TOKA GDMS — Products Catalog API
import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Product } from '@/types';

// Default seed products matching database schema (Standard Full Sheets & Ordered Half Sheets)
const DEFAULT_PRODUCTS: Product[] = [
  {
    id: '22222222-2222-2222-2222-222222222201',
    categoryId: '11111111-1111-1111-1111-111111111101',
    categoryName: 'Clear Float Glass',
    sku: 'GL-CLR-04-2418',
    name: '4mm Clear Sheet Glass',
    thicknessMm: 4.0,
    color: 'Clear',
    standardDimensionLabel: '2440x1830mm',
    standardFullSheetPrice: 3200.0,
    standardHalfSheetPrice: 1750.0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222202',
    categoryId: '11111111-1111-1111-1111-111111111101',
    categoryName: 'Clear Float Glass',
    sku: 'GL-CLR-05-2418',
    name: '5mm Clear Sheet Glass',
    thicknessMm: 5.0,
    color: 'Clear',
    standardDimensionLabel: '2440x1830mm',
    standardFullSheetPrice: 4100.0,
    standardHalfSheetPrice: 2200.0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222203',
    categoryId: '11111111-1111-1111-1111-111111111101',
    categoryName: 'Clear Float Glass',
    sku: 'GL-CLR-06-2418',
    name: '6mm Clear Sheet Glass',
    thicknessMm: 6.0,
    color: 'Clear',
    standardDimensionLabel: '2440x1830mm',
    standardFullSheetPrice: 5200.0,
    standardHalfSheetPrice: 2800.0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222204',
    categoryId: '11111111-1111-1111-1111-111111111102',
    categoryName: 'Tinted Float Glass',
    sku: 'GL-BRZ-05-2418',
    name: '5mm Bronze Tinted Glass',
    thicknessMm: 5.0,
    color: 'Bronze',
    standardDimensionLabel: '2440x1830mm',
    standardFullSheetPrice: 4800.0,
    standardHalfSheetPrice: 2600.0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222205',
    categoryId: '11111111-1111-1111-1111-111111111102',
    categoryName: 'Tinted Float Glass',
    sku: 'GL-GRY-05-2418',
    name: '5mm Dark Grey Tinted Glass',
    thicknessMm: 5.0,
    color: 'Dark Grey',
    standardDimensionLabel: '2440x1830mm',
    standardFullSheetPrice: 4900.0,
    standardHalfSheetPrice: 2650.0,
    isActive: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '22222222-2222-2222-2222-222222222206',
    categoryId: '11111111-1111-1111-1111-111111111103',
    categoryName: 'Mirrors',
    sku: 'MR-SLV-04-2418',
    name: '4mm Silver Mirror Sheet',
    thicknessMm: 4.0,
    color: 'Silver',
    standardDimensionLabel: '2440x1830mm',
    standardFullSheetPrice: 4500.0,
    standardHalfSheetPrice: 2450.0,
    isActive: true,
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
        .from('products')
        .select(`
          id,
          category_id,
          sku,
          name,
          thickness_mm,
          color,
          standard_dimension_label,
          standard_full_sheet_price,
          standard_half_sheet_price,
          is_active,
          created_at,
          updated_at,
          product_categories (name)
        `)
        .eq('is_active', true)
        .order('sku');

      if (error) {
        console.error('[PRODUCTS API ERROR]', error);
        return NextResponse.json(
          { success: false, error: `Database error: ${error.message}` },
          { status: 500 }
        );
      }

      const formatted: Product[] = (data || []).map((p: any) => ({
        id: p.id,
        categoryId: p.category_id,
        categoryName: p.product_categories?.name,
        sku: p.sku,
        name: p.name,
        thicknessMm: parseFloat(p.thickness_mm),
        color: p.color,
        standardDimensionLabel: p.standard_dimension_label,
        standardFullSheetPrice: parseFloat(p.standard_full_sheet_price),
        standardHalfSheetPrice: parseFloat(p.standard_half_sheet_price),
        isActive: p.is_active,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      }));

      return NextResponse.json({ success: true, data: formatted });
    }

    // Fallback default products for offline/dev
    return NextResponse.json({ success: true, data: DEFAULT_PRODUCTS });
  } catch (err: any) {
    console.error('[PRODUCTS API EXCEPTION]', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
