-- TOKA GDMS — Use Nairobi business dates for financial ledgers
-- Supabase database sessions commonly run in UTC; employee turnover shifts and
-- collection references must follow the company's Africa/Nairobi business day.
BEGIN;

ALTER FUNCTION public.submit_delivery_atomic(
  TEXT, UUID, TEXT, UUID, UUID, UUID,
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  payment_status_enum,
  NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB, JSONB, UUID
) SET timezone TO 'Africa/Nairobi';

ALTER FUNCTION public.record_customer_collection(
  UUID, payment_channel_enum, NUMERIC, TEXT, TEXT
) SET timezone TO 'Africa/Nairobi';

COMMIT;
