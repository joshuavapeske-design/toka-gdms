-- TOKA GDMS — Pre-Supabase security and transaction hardening
-- Additive migration. Does not rewrite previously applied migration history.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Approval records and durable notification dispatch state
-- ---------------------------------------------------------------------------
ALTER TABLE price_approval_requests
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT;

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS discount_approval_id UUID;

CREATE TABLE IF NOT EXISTS discount_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_reference TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  subtotal_amount NUMERIC(14,2) NOT NULL CHECK (subtotal_amount > 0),
  requested_discount_amount NUMERIC(14,2) NOT NULL CHECK (requested_discount_amount > 0 AND requested_discount_amount <= subtotal_amount),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  status approval_status_enum NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES profiles(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT chk_discount_different_reviewer CHECK (requested_by <> reviewed_by),
  CONSTRAINT uq_discount_approval_delivery UNIQUE (delivery_reference)
);

ALTER TABLE deliveries
  ADD CONSTRAINT fk_deliveries_discount_approval
  FOREIGN KEY (discount_approval_id) REFERENCES discount_approval_requests(id) ON DELETE RESTRICT;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS chk_notifications_status;
ALTER TABLE notifications ADD CONSTRAINT chk_notifications_status
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'failed'));

CREATE INDEX IF NOT EXISTS idx_notifications_dispatch
  ON notifications(status, next_retry_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_vehicle_stock_location
  ON stock_locations(vehicle_id)
  WHERE vehicle_id IS NOT NULL AND is_active = true;

-- ---------------------------------------------------------------------------
-- 2. Narrow, explicit role assertion helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.require_active_role(p_allowed_roles user_role_enum[])
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_role user_role_enum;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED: A signed-in employee is required';
  END IF;

  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = v_user_id AND is_active = true;

  IF v_role IS NULL OR NOT (v_role = ANY(p_allowed_roles)) THEN
    RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: Active employee role is not permitted for this operation';
  END IF;

  RETURN v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION auth.require_active_role(user_role_enum[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auth.require_active_role(user_role_enum[]) TO authenticated;

-- Replace privilege checks that previously relied on SECURITY DEFINER's current_user.
CREATE OR REPLACE FUNCTION protect_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role user_role_enum;
  v_active_owner_count INTEGER;
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role OR OLD.is_active IS DISTINCT FROM NEW.is_active THEN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Authenticated owner identity is required to change roles or account status';
    END IF;

    SELECT role INTO v_actor_role
    FROM public.profiles
    WHERE id = v_actor_id AND is_active = true;

    IF v_actor_role IS DISTINCT FROM 'owner'::user_role_enum THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Only an active owner may change roles or account status';
    END IF;

    IF OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.is_active = false) THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('toka:active-owner-count', 0));
      SELECT COUNT(*) INTO v_active_owner_count
      FROM public.profiles
      WHERE role = 'owner' AND is_active = true AND id <> OLD.id;
      IF v_active_owner_count = 0 THEN
        RAISE EXCEPTION 'INVALID_OPERATION: Cannot demote or deactivate the last active owner';
      END IF;
    END IF;

    INSERT INTO public.audit_logs(actor_id, action_type, entity_name, entity_id, payload_before, payload_after)
    VALUES (
      v_actor_id, 'PROFILE_PRIVILEGE_CHANGE', 'profiles', OLD.id,
      jsonb_build_object('role', OLD.role, 'is_active', OLD.is_active),
      jsonb_build_object('role', NEW.role, 'is_active', NEW.is_active)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_delivery_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.client_tx_id IS DISTINCT FROM NEW.client_tx_id
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.delivery_reference IS DISTINCT FROM NEW.delivery_reference
     OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.vehicle_assignment_id IS DISTINCT FROM NEW.vehicle_assignment_id
     OR OLD.subtotal_amount IS DISTINCT FROM NEW.subtotal_amount
     OR OLD.discount_amount IS DISTINCT FROM NEW.discount_amount
     OR OLD.total_amount IS DISTINCT FROM NEW.total_amount
     OR OLD.total_declared_paid IS DISTINCT FROM NEW.total_declared_paid
     OR OLD.discount_approval_id IS DISTINCT FROM NEW.discount_approval_id THEN
    RAISE EXCEPTION 'IMMUTABLE_DELIVERY: Original delivery identity and financial snapshots cannot be rewritten';
  END IF;

  IF (OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance
      OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
     AND current_setting('toka.allow_collection_balance_update', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CONTROLLED_BALANCE_UPDATE_REQUIRED: Only the collection allocation procedure may update receivable balance';
  END IF;

  IF OLD.customer_confirmation_status IS DISTINCT FROM NEW.customer_confirmation_status
     AND current_setting('toka.allow_sms_status_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CONTROLLED_CONFIRMATION_TRANSITION_REQUIRED: Customer confirmation must be changed through the SMS procedure';
  END IF;

  IF OLD.operational_status IS DISTINCT FROM NEW.operational_status
     OR OLD.reconciliation_status IS DISTINCT FROM NEW.reconciliation_status THEN
    RAISE EXCEPTION 'CONTROLLED_STATUS_TRANSITION_REQUIRED: Operational and reconciliation changes require an authorized workflow';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Protect approvals against forged pre-approved rows or reviewer spoofing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_price_approval_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role user_role_enum;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR NEW.requested_by IS DISTINCT FROM v_actor
       OR NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL
       OR NEW.customer_id IS NULL THEN
      RAISE EXCEPTION 'INVALID_PRICE_APPROVAL_REQUEST: New requests must be pending, customer-bound and created by the authenticated requester';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending'
     OR NEW.status NOT IN ('approved', 'rejected')
     OR v_actor IS NULL
     OR NEW.reviewed_by IS DISTINCT FROM v_actor
     OR NEW.requested_by = v_actor
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.selling_unit IS DISTINCT FROM OLD.selling_unit
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.delivery_reference IS DISTINCT FROM OLD.delivery_reference
     OR NEW.official_price IS DISTINCT FROM OLD.official_price
     OR NEW.requested_price IS DISTINCT FROM OLD.requested_price
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'INVALID_PRICE_APPROVAL_TRANSITION: Approval request fields are immutable and only a different authorized reviewer may decide it';
  END IF;

  SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor AND is_active = true;
  IF v_actor_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'PRICE_APPROVER_UNAUTHORIZED: Only an active owner or manager may review a price request';
  END IF;

  NEW.reviewed_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_price_approval_request ON price_approval_requests;
CREATE TRIGGER trg_guard_price_approval_request
BEFORE INSERT OR UPDATE ON price_approval_requests
FOR EACH ROW EXECUTE FUNCTION guard_price_approval_request();

DROP POLICY IF EXISTS "price_approvals_insert" ON price_approval_requests;
CREATE POLICY "price_approvals_insert" ON price_approval_requests
FOR INSERT WITH CHECK (
  requested_by = auth.uid()
  AND customer_id IS NOT NULL
  AND status = 'pending'
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
);

DROP POLICY IF EXISTS "price_approvals_update" ON price_approval_requests;
CREATE POLICY "price_approvals_update" ON price_approval_requests
FOR UPDATE
USING (auth.get_user_role() IN ('owner', 'manager') AND requested_by <> auth.uid() AND status = 'pending')
WITH CHECK (
  auth.get_user_role() IN ('owner', 'manager')
  AND requested_by <> auth.uid()
  AND reviewed_by = auth.uid()
  AND status IN ('approved', 'rejected')
);

CREATE OR REPLACE FUNCTION guard_discount_approval_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_actor_role user_role_enum;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF v_actor IS NULL OR NEW.requested_by IS DISTINCT FROM v_actor
       OR NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_DISCOUNT_REQUEST: New discount requests must be pending and created by the authenticated requester';
    END IF;
    SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor AND is_active = true;
    IF v_actor_role NOT IN ('owner', 'manager', 'salesperson', 'driver') THEN
      RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: User cannot request a delivery discount';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'pending'
     OR NEW.status NOT IN ('approved', 'rejected')
     OR v_actor IS NULL
     OR NEW.reviewed_by IS DISTINCT FROM v_actor
     OR NEW.requested_by = v_actor
     OR NEW.delivery_reference IS DISTINCT FROM OLD.delivery_reference
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount
     OR NEW.requested_discount_amount IS DISTINCT FROM OLD.requested_discount_amount
     OR NEW.reason IS DISTINCT FROM OLD.reason THEN
    RAISE EXCEPTION 'INVALID_DISCOUNT_APPROVAL_TRANSITION: Request fields are immutable and requester cannot approve own discount';
  END IF;

  SELECT role INTO v_actor_role FROM profiles WHERE id = v_actor AND is_active = true;
  IF v_actor_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'DISCOUNT_APPROVER_UNAUTHORIZED: Only an active owner or manager may review a discount';
  END IF;

  NEW.reviewed_at := timezone('utc', now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_discount_approval_request ON discount_approval_requests;
CREATE TRIGGER trg_guard_discount_approval_request
BEFORE INSERT OR UPDATE ON discount_approval_requests
FOR EACH ROW EXECUTE FUNCTION guard_discount_approval_request();

ALTER TABLE discount_approval_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS discount_approval_select ON discount_approval_requests;
CREATE POLICY discount_approval_select ON discount_approval_requests
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant') OR requested_by = auth.uid());
DROP POLICY IF EXISTS discount_approval_insert ON discount_approval_requests;
CREATE POLICY discount_approval_insert ON discount_approval_requests
FOR INSERT WITH CHECK (requested_by = auth.uid() AND status = 'pending' AND reviewed_by IS NULL);
DROP POLICY IF EXISTS discount_approval_update ON discount_approval_requests;
CREATE POLICY discount_approval_update ON discount_approval_requests
FOR UPDATE
USING (auth.get_user_role() IN ('owner', 'manager') AND requested_by <> auth.uid() AND status = 'pending')
WITH CHECK (auth.get_user_role() IN ('owner', 'manager') AND requested_by <> auth.uid() AND reviewed_by = auth.uid() AND status IN ('approved', 'rejected'));

CREATE OR REPLACE FUNCTION review_discount_approval(
  p_approval_id UUID,
  p_approve BOOLEAN,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_request discount_approval_requests%ROWTYPE;
BEGIN
  v_actor := auth.require_active_role(ARRAY['owner'::user_role_enum, 'manager'::user_role_enum]);
  SELECT * INTO v_request FROM discount_approval_requests WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DISCOUNT_REQUEST_NOT_FOUND'; END IF;
  IF v_request.status <> 'pending' THEN RAISE EXCEPTION 'DISCOUNT_REQUEST_ALREADY_REVIEWED'; END IF;
  IF v_request.requested_by = v_actor THEN RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN'; END IF;

  UPDATE discount_approval_requests
  SET status = CASE WHEN p_approve THEN 'approved'::approval_status_enum ELSE 'rejected'::approval_status_enum END,
      reviewed_by = v_actor,
      reviewed_at = timezone('utc', now()),
      rejection_reason = CASE WHEN p_approve THEN NULL ELSE NULLIF(trim(p_rejection_reason), '') END
  WHERE id = p_approval_id;

  INSERT INTO audit_logs(actor_id, action_type, entity_name, entity_id, payload_after)
  VALUES(v_actor, CASE WHEN p_approve THEN 'DISCOUNT_APPROVED' ELSE 'DISCOUNT_REJECTED' END,
         'discount_approval_requests', p_approval_id,
         jsonb_build_object('delivery_reference', v_request.delivery_reference, 'amount', v_request.requested_discount_amount));

  RETURN jsonb_build_object('success', true, 'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END);
END;
$$;

CREATE OR REPLACE FUNCTION validate_delivery_discount_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_approval discount_approval_requests%ROWTYPE;
  v_reviewer_role user_role_enum;
BEGIN
  IF COALESCE(NEW.discount_amount, 0) = 0 THEN
    NEW.discount_approval_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO v_approval
  FROM discount_approval_requests
  WHERE delivery_reference = NEW.delivery_reference
    AND customer_id = NEW.customer_id
    AND requested_by = NEW.created_by
    AND subtotal_amount = NEW.subtotal_amount
    AND requested_discount_amount = NEW.discount_amount
    AND status = 'approved'
  FOR UPDATE;

  IF NOT FOUND OR v_approval.reviewed_by IS NULL OR v_approval.reviewed_by = NEW.created_by THEN
    RAISE EXCEPTION 'DISCOUNT_NOT_AUTHORIZED: Non-zero invoice discount requires an approved, transaction-bound discount request';
  END IF;

  SELECT role INTO v_reviewer_role
  FROM profiles WHERE id = v_approval.reviewed_by AND is_active = true;
  IF v_reviewer_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'DISCOUNT_APPROVER_UNAUTHORIZED';
  END IF;

  NEW.discount_approval_id := v_approval.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_delivery_discount ON deliveries;
CREATE TRIGGER trg_validate_delivery_discount
BEFORE INSERT ON deliveries
FOR EACH ROW EXECUTE FUNCTION validate_delivery_discount_approval();

-- ---------------------------------------------------------------------------
-- 4. Correct per-line official price snapshots and customer-bound approvals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_delivery_item_price()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_customer_id UUID;
  v_created_by UUID;
  v_product products%ROWTYPE;
  v_base_price NUMERIC(14,2);
  v_customer_price NUMERIC(14,2);
  v_price_count INTEGER;
  v_approval price_approval_requests%ROWTYPE;
  v_reviewer_role user_role_enum;
BEGIN
  SELECT customer_id, created_by INTO v_customer_id, v_created_by
  FROM deliveries WHERE id = NEW.delivery_id;
  IF v_customer_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_NOT_FOUND_FOR_LINE_ITEM'; END IF;

  SELECT * INTO v_product FROM products
  WHERE id = NEW.product_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND_OR_INACTIVE'; END IF;

  SELECT COUNT(*), MIN(authorized_price)
  INTO v_price_count, v_customer_price
  FROM customer_prices
  WHERE customer_id = v_customer_id
    AND product_id = NEW.product_id
    AND selling_unit = NEW.selling_unit
    AND is_active = true
    AND valid_from <= timezone('utc', now())
    AND (valid_to IS NULL OR valid_to > timezone('utc', now()));

  IF v_price_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_CUSTOMER_PRICE: Multiple active customer price records overlap';
  ELSIF v_price_count = 1 THEN
    v_base_price := v_customer_price;
  ELSIF NEW.selling_unit = 'FULL_SHEET' THEN
    v_base_price := v_product.standard_full_sheet_price;
  ELSE
    v_base_price := v_product.standard_half_sheet_price;
  END IF;

  IF NEW.applied_unit_price IS DISTINCT FROM v_base_price THEN
    SELECT * INTO v_approval
    FROM price_approval_requests
    WHERE id = NEW.price_approval_id
      AND customer_id = v_customer_id
      AND product_id = NEW.product_id
      AND selling_unit = NEW.selling_unit
      AND requested_by = v_created_by
      AND delivery_reference = (SELECT delivery_reference FROM deliveries WHERE id = NEW.delivery_id)
      AND official_price = v_base_price
      AND requested_price = NEW.applied_unit_price
      AND status = 'approved';

    IF NOT FOUND OR v_approval.reviewed_by IS NULL OR v_approval.reviewed_by = v_created_by THEN
      RAISE EXCEPTION 'UNAUTHORIZED_PRICE: Applied price differs from authorized customer/company price without a valid approval';
    END IF;

    SELECT role INTO v_reviewer_role
    FROM profiles WHERE id = v_approval.reviewed_by AND is_active = true;
    IF v_reviewer_role NOT IN ('owner', 'manager') THEN
      RAISE EXCEPTION 'PRICE_APPROVER_UNAUTHORIZED';
    END IF;
  ELSE
    IF NEW.price_approval_id IS NOT NULL THEN
      RAISE EXCEPTION 'UNNECESSARY_PRICE_APPROVAL: Price approval supplied for an unchanged authorized price';
    END IF;
  END IF;

  NEW.official_unit_price := v_base_price;
  NEW.is_special_price := NEW.applied_unit_price IS DISTINCT FROM v_base_price;
  NEW.line_total := ROUND(NEW.quantity * NEW.applied_unit_price, 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_delivery_item_price ON delivery_items;
CREATE TRIGGER trg_enforce_delivery_item_price
BEFORE INSERT ON delivery_items
FOR EACH ROW EXECUTE FUNCTION enforce_delivery_item_price();

CREATE OR REPLACE FUNCTION prevent_overlapping_customer_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key TEXT;
BEGIN
  v_lock_key := NEW.customer_id::text || ':' || NEW.product_id::text || ':' || NEW.selling_unit::text;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_lock_key, 0));

  IF NEW.is_active AND EXISTS (
    SELECT 1 FROM customer_prices cp
    WHERE cp.customer_id = NEW.customer_id
      AND cp.product_id = NEW.product_id
      AND cp.selling_unit = NEW.selling_unit
      AND cp.is_active = true
      AND cp.id IS DISTINCT FROM NEW.id
      AND COALESCE(cp.valid_to, 'infinity'::timestamptz) > NEW.valid_from
      AND COALESCE(NEW.valid_to, 'infinity'::timestamptz) > cp.valid_from
  ) THEN
    RAISE EXCEPTION 'OVERLAPPING_CUSTOMER_PRICE_PERIOD: Active customer price periods must not overlap';
  END IF;
  IF NEW.valid_to IS NOT NULL AND NEW.valid_to <= NEW.valid_from THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_PRICE_PERIOD: valid_to must be later than valid_from';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_overlapping_customer_prices ON customer_prices;
CREATE TRIGGER trg_prevent_overlapping_customer_prices
BEFORE INSERT OR UPDATE ON customer_prices
FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_customer_prices();

-- ---------------------------------------------------------------------------
-- 5. Restrict historical delivery updates; allow only validated workflow deltas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_delivery_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.client_tx_id IS DISTINCT FROM NEW.client_tx_id
     OR OLD.payload_hash IS DISTINCT FROM NEW.payload_hash
     OR OLD.delivery_reference IS DISTINCT FROM NEW.delivery_reference
     OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.vehicle_assignment_id IS DISTINCT FROM NEW.vehicle_assignment_id
     OR OLD.subtotal_amount IS DISTINCT FROM NEW.subtotal_amount
     OR OLD.discount_amount IS DISTINCT FROM NEW.discount_amount
     OR OLD.total_amount IS DISTINCT FROM NEW.total_amount
     OR OLD.total_declared_paid IS DISTINCT FROM NEW.total_declared_paid
     OR OLD.discount_approval_id IS DISTINCT FROM NEW.discount_approval_id THEN
    RAISE EXCEPTION 'IMMUTABLE_DELIVERY: Original transaction identity and invoice values cannot be rewritten';
  END IF;

  IF (OLD.outstanding_balance IS DISTINCT FROM NEW.outstanding_balance
      OR OLD.payment_status IS DISTINCT FROM NEW.payment_status)
     AND current_setting('toka.allow_collection_balance_update', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CONTROLLED_BALANCE_UPDATE_REQUIRED: Subsequent collection balances must be changed through the allocation procedure';
  END IF;

  IF OLD.customer_confirmation_status IS DISTINCT FROM NEW.customer_confirmation_status
     AND current_setting('toka.allow_sms_status_transition', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CONTROLLED_CONFIRMATION_TRANSITION_REQUIRED: Customer confirmation must be updated through the trusted SMS procedure';
  END IF;

  IF OLD.operational_status IS DISTINCT FROM NEW.operational_status
     OR OLD.reconciliation_status IS DISTINCT FROM NEW.reconciliation_status THEN
    RAISE EXCEPTION 'CONTROLLED_STATUS_TRANSITION_REQUIRED: Operational and reconciliation status changes require a dedicated workflow';
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "deliveries_update_policy" ON deliveries;
DROP POLICY IF EXISTS deliveries_update_policy ON deliveries;
-- No authenticated user writes transaction children directly. Sensitive records
-- are created only through validated, atomic SECURITY DEFINER workflows.
DROP POLICY IF EXISTS "deliveries_insert_policy" ON deliveries;
DROP POLICY IF EXISTS "delivery_items_insert" ON delivery_items;
DROP POLICY IF EXISTS "payment_decl_insert" ON payment_declarations;
DROP POLICY IF EXISTS "collections_insert" ON collections;
DROP POLICY IF EXISTS "allocations_insert" ON payment_allocations;
DROP POLICY IF EXISTS "reversals_insert" ON payment_reversals;
DROP POLICY IF EXISTS "disputes_modify" ON customer_disputes;
DROP POLICY IF EXISTS "turnovers_insert_update" ON employee_turnovers;
CREATE POLICY "turnovers_select_only" ON employee_turnovers
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant') OR employee_id = auth.uid());

-- Restrict broad financial visibility.
DROP POLICY IF EXISTS "credit_accounts_select" ON credit_accounts;
CREATE POLICY "credit_accounts_select" ON credit_accounts
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant', 'salesperson', 'driver'));
DROP POLICY IF EXISTS "credit_accounts_update" ON credit_accounts;
DROP POLICY IF EXISTS credit_accounts_update ON credit_accounts;
DROP POLICY IF EXISTS "allocations_select" ON payment_allocations;
CREATE POLICY "allocations_select" ON payment_allocations
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));
DROP POLICY IF EXISTS "confirmations_select" ON customer_confirmations;
CREATE POLICY "confirmations_select" ON customer_confirmations
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));
DROP POLICY IF EXISTS "confirmation_events_select" ON customer_confirmation_events;
CREATE POLICY "confirmation_events_select" ON customer_confirmation_events
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));
DROP POLICY IF EXISTS "disputes_select" ON customer_disputes;
CREATE POLICY "disputes_select" ON customer_disputes
FOR SELECT USING (auth.get_user_role() IN ('owner', 'manager', 'accountant'));

-- ---------------------------------------------------------------------------
-- 6. Hardened business RPC replacements
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION submit_delivery_atomic(
    p_delivery_reference TEXT,
    p_client_tx_id UUID,
    p_payload_hash TEXT,
    p_customer_id UUID,
    p_created_by UUID,
    p_vehicle_assignment_id UUID,
    p_subtotal_amount NUMERIC,
    p_discount_amount NUMERIC,
    p_total_amount NUMERIC,
    p_total_declared_paid NUMERIC,
    p_outstanding_balance NUMERIC,
    p_payment_status payment_status_enum,
    p_delivery_lat NUMERIC DEFAULT NULL,
    p_delivery_lng NUMERIC DEFAULT NULL,
    p_gps_accuracy_m NUMERIC DEFAULT NULL,
    p_device_captured_at TIMESTAMPTZ DEFAULT NULL,
    p_is_offline_submission BOOLEAN DEFAULT false,
    p_notes TEXT DEFAULT NULL,
    p_items JSONB DEFAULT '[]'::jsonb,
    p_payments JSONB DEFAULT '[]'::jsonb,
    p_warehouse_location_id UUID DEFAULT '33333333-3333-3333-3333-333333333301'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role user_role_enum;
    v_existing_id UUID;
    v_existing_hash TEXT;
    v_delivery_id UUID;
    v_trans_id UUID;
    v_turnover_id UUID;
    v_assignment RECORD;
    v_customer RECORD;
    v_effective_delivery_time TIMESTAMPTZ;
    v_credit_acc RECORD;
    v_source_location_id UUID;
    
    -- Calculated financial totals
    v_calc_subtotal NUMERIC := 0.00;
    v_calc_discount NUMERIC := 0.00;
    v_calc_total NUMERIC := 0.00;
    v_calc_declared_paid NUMERIC := 0.00;
    v_calc_outstanding NUMERIC := 0.00;
    v_derived_status payment_status_enum;
    
    -- Payment channel breakdowns
    v_cash_declared NUMERIC := 0.00;
    v_emp_mpesa_declared NUMERIC := 0.00;
    v_till_mpesa_declared NUMERIC := 0.00;
    v_bank_declared NUMERIC := 0.00;
    v_credit_declared NUMERIC := 0.00;
    
    -- Line item cursor
    v_item RECORD;
    v_product RECORD;
    v_item_unit selling_unit_enum;
    v_item_qty INT;
    v_auth_unit_price NUMERIC;
    v_item_total NUMERIC;
    v_customer_price NUMERIC;
    v_approval RECORD;
    
    -- Stock balances
    v_avail_full INT;
    v_avail_halves INT;
    v_order_halves INT;
    v_halves_from_stock INT;
    v_shortage INT;
    v_full_to_split INT;
    
    -- Payment cursor
    v_payment RECORD;
    v_sms_payload TEXT;
    v_item_summary TEXT;
BEGIN
    -- 1. CALLER AUTHENTICATION & ROLE VERIFICATION
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Caller must be authenticated to submit deliveries';
    END IF;

    IF v_caller_id != p_created_by THEN
        RAISE EXCEPTION 'UNAUTHORIZED: p_created_by (%) does not match authenticated user (%)', p_created_by, v_caller_id;
    END IF;

    SELECT role INTO v_caller_role
    FROM profiles
    WHERE id = v_caller_id AND is_active = true;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'ACCESS_DENIED: Caller profile not found or account is deactivated';
    END IF;

    IF v_caller_role NOT IN ('owner', 'manager', 'salesperson', 'driver') THEN
        RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: Role % is not authorized to submit deliveries', v_caller_role;
    END IF;

    -- 2. VEHICLE SHIFT ASSIGNMENT VERIFICATION
    SELECT va.id, va.vehicle_id, va.driver_id, va.salesperson_id, va.is_active,
           va.shift_date, va.started_at, va.ended_at,
           v.status AS vehicle_status, v.is_active AS vehicle_active
    INTO v_assignment
    FROM vehicle_assignments va
    JOIN vehicles v ON v.id = va.vehicle_id
    WHERE va.id = p_vehicle_assignment_id;

    IF v_assignment.id IS NULL THEN
        RAISE EXCEPTION 'INVALID_ASSIGNMENT: Vehicle assignment % does not exist', p_vehicle_assignment_id;
    END IF;

    -- Online submissions require a currently active assignment. An offline delivery
    -- may arrive after the shift has closed, but only when the assignment has a real
    -- ended_at timestamp; the original device capture time is validated below.
    IF NOT v_assignment.is_active
       AND (NOT p_is_offline_submission OR v_assignment.ended_at IS NULL) THEN
        RAISE EXCEPTION 'INACTIVE_ASSIGNMENT: Vehicle assignment % is not active for this submission', p_vehicle_assignment_id;
    END IF;

    v_effective_delivery_time := CASE
        WHEN p_is_offline_submission AND p_device_captured_at IS NOT NULL THEN p_device_captured_at
        ELSE now()
    END;

    IF v_effective_delivery_time > now() + INTERVAL '5 minutes'
       OR v_assignment.shift_date <> timezone('Africa/Nairobi', v_effective_delivery_time)::date
       OR v_assignment.started_at > v_effective_delivery_time
       OR (v_assignment.ended_at IS NOT NULL AND v_assignment.ended_at <= v_effective_delivery_time) THEN
        RAISE EXCEPTION 'SHIFT_OUTSIDE_CAPTURE_WINDOW: Delivery capture timestamp is outside the assigned shift window for assignment %', p_vehicle_assignment_id;
    END IF;

    IF v_assignment.vehicle_status != 'active' OR NOT v_assignment.vehicle_active THEN
        RAISE EXCEPTION 'VEHICLE_UNAVAILABLE: Assigned vehicle is % or inactive', v_assignment.vehicle_status;
    END IF;

    IF v_caller_role IN ('driver', 'salesperson') THEN
        IF v_assignment.driver_id != v_caller_id AND v_assignment.salesperson_id != v_caller_id THEN
            RAISE EXCEPTION 'UNAUTHORIZED_SHIFT: Caller % is not assigned to vehicle assignment %', v_caller_id, p_vehicle_assignment_id;
        END IF;
    ELSIF v_caller_role IN ('owner', 'manager') THEN
        IF v_assignment.driver_id != v_caller_id AND v_assignment.salesperson_id != v_caller_id THEN
            INSERT INTO audit_logs (actor_id, action_type, entity_name, entity_id, payload_after)
            VALUES (v_caller_id, 'ADMIN_DELIVERY_OVERRIDE', 'vehicle_assignments', p_vehicle_assignment_id,
                    jsonb_build_object('notes', 'Manager/Owner ' || v_caller_id || ' submitted delivery ' || p_delivery_reference || ' on assignment ' || p_vehicle_assignment_id));
        END IF;
    END IF;

    -- 3. RESOLVE SOURCE STOCK LOCATION (VEHICLE LOCATION FIRST)
    SELECT id INTO v_source_location_id
    FROM stock_locations
    WHERE vehicle_id = v_assignment.vehicle_id AND is_active = true;

    IF v_source_location_id IS NULL THEN
        RAISE EXCEPTION 'VEHICLE_STOCK_LOCATION_NOT_FOUND: Vehicle % has no active stock location. Dispatch stock before creating a delivery.',
            v_assignment.vehicle_id;
    END IF;

    -- 4. CANONICAL PAYLOAD HASH IDEMPOTENCY CHECK
    IF p_payload_hash IS NULL OR p_payload_hash = '' THEN
        RAISE EXCEPTION 'PAYLOAD_HASH_REQUIRED: Canonical SHA-256 payload hash is required';
    END IF;

    SELECT id, payload_hash INTO v_existing_id, v_existing_hash
    FROM deliveries
    WHERE client_tx_id = p_client_tx_id;

    IF v_existing_id IS NOT NULL THEN
        IF v_existing_hash IS DISTINCT FROM p_payload_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: Existing delivery with clientTxId % has differing payload hash', p_client_tx_id;
        END IF;

        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'delivery_id', v_existing_id,
            'delivery_reference', p_delivery_reference,
            'message', 'Delivery was already synchronized.'
        );
    END IF;

    -- 5. CUSTOMER VALIDATION
    SELECT id, is_credit_eligible, credit_limit, primary_phone, name
    INTO v_customer
    FROM customers
    WHERE id = p_customer_id AND is_active = true
    FOR UPDATE;

    IF v_customer.id IS NULL THEN
        RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: Customer % does not exist or is inactive', p_customer_id;
    END IF;

    -- Serialize credit operations per customer, including creation of a missing account.
    PERFORM 1 FROM customers WHERE id = p_customer_id FOR UPDATE;

    -- 6. INDEPENDENT FINANCIAL VALIDATION & PRICING
    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'EMPTY_DELIVERY: Delivery must contain at least one line item';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "sellingUnit" TEXT,
        "quantity" INT,
        "appliedUnitPrice" NUMERIC,
        "priceApprovalId" UUID
    )
    LOOP
        v_item_unit := v_item."sellingUnit"::selling_unit_enum;
        v_item_qty := v_item."quantity";

        IF v_item_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY: Line item quantity must be positive';
        END IF;

        IF v_item."appliedUnitPrice" < 0 THEN
            RAISE EXCEPTION 'INVALID_PRICE: Unit price cannot be negative';
        END IF;

        -- Verify product exists
        SELECT id, name, sku, standard_full_sheet_price, standard_half_sheet_price
        INTO v_product
        FROM products
        WHERE id = v_item."productId" AND is_active = true;

        IF v_product.id IS NULL THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product % does not exist or is inactive', v_item."productId";
        END IF;

        -- Resolve authorized base price:
        -- 1. Effective-dated customer price
        v_customer_price := NULL;
        SELECT authorized_price INTO v_customer_price
        FROM customer_prices
        WHERE customer_id = p_customer_id
          AND product_id = v_item."productId"
          AND selling_unit = v_item_unit
          AND is_active = true
          AND valid_from <= timezone('utc', now())
          AND (valid_to IS NULL OR valid_to > timezone('utc', now()))
        ORDER BY valid_from DESC
        LIMIT 1;

        IF v_customer_price IS NOT NULL THEN
            v_auth_unit_price := v_customer_price;
        ELSE
            IF v_item_unit = 'FULL_SHEET' THEN
                v_auth_unit_price := v_product.standard_full_sheet_price;
            ELSE
                v_auth_unit_price := v_product.standard_half_sheet_price;
            END IF;
        END IF;

        -- 2. Verify special price approval if price differs from authorized base
        IF v_item."appliedUnitPrice" != v_auth_unit_price THEN
            IF v_item."priceApprovalId" IS NULL THEN
                RAISE EXCEPTION 'UNAUTHORIZED_PRICE: Applied price % differs from authorized base % without approval for product %',
                    v_item."appliedUnitPrice", v_auth_unit_price, v_product.sku;
            END IF;

            SELECT id, status, requested_by, reviewed_by, requested_price, customer_id, product_id, selling_unit
            INTO v_approval
            FROM price_approval_requests
            WHERE id = v_item."priceApprovalId";

            IF v_approval.id IS NULL OR v_approval.status != 'approved' THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_INVALID: Price approval % is not approved', v_item."priceApprovalId";
            END IF;

            IF v_approval.customer_id IS DISTINCT FROM p_customer_id OR v_approval.requested_by IS DISTINCT FROM p_created_by THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_SCOPE_MISMATCH: Approval must belong to this customer and submitting employee';
            END IF;

            PERFORM 1 FROM profiles
            WHERE id = v_approval.reviewed_by AND is_active = true AND role IN ('owner', 'manager');
            IF NOT FOUND THEN
                RAISE EXCEPTION 'PRICE_APPROVER_UNAUTHORIZED: Reviewer must be an active owner or manager';
            END IF;

            IF v_approval.requested_by = v_approval.reviewed_by THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_ILLEGAL: Anti-self-approval violation on approval %', v_item."priceApprovalId";
            END IF;

            IF v_approval.product_id != v_item."productId" OR v_approval.selling_unit != v_item_unit THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_MISMATCH: Approval % does not match product or unit', v_item."priceApprovalId";
            END IF;

            IF v_approval.requested_price != v_item."appliedUnitPrice" THEN
                RAISE EXCEPTION 'PRICE_APPROVAL_PRICE_MISMATCH: Approved price % != applied price %',
                    v_approval.requested_price, v_item."appliedUnitPrice";
            END IF;
        END IF;

        v_item_total := ROUND(v_item_qty * v_item."appliedUnitPrice", 2);
        v_calc_subtotal := v_calc_subtotal + v_item_total;
    END LOOP;

    -- Subtotal integrity check
    IF p_subtotal_amount IS NOT NULL AND ABS(p_subtotal_amount - v_calc_subtotal) > 0.01 THEN
        RAISE EXCEPTION 'SUBTOTAL_MISMATCH: Submitted subtotal % != calculated subtotal %', p_subtotal_amount, v_calc_subtotal;
    END IF;

    -- Discount integrity check
    v_calc_discount := COALESCE(p_discount_amount, 0.00);
    IF v_calc_discount < 0 THEN
        RAISE EXCEPTION 'INVALID_DISCOUNT: Discount cannot be negative';
    END IF;
    IF v_calc_discount > v_calc_subtotal THEN
        RAISE EXCEPTION 'INVALID_DISCOUNT: Discount % cannot exceed subtotal %', v_calc_discount, v_calc_subtotal;
    END IF;

    v_calc_total := v_calc_subtotal - v_calc_discount;
    IF p_total_amount IS NOT NULL AND ABS(p_total_amount - v_calc_total) > 0.01 THEN
        RAISE EXCEPTION 'TOTAL_MISMATCH: Submitted total % != calculated total %', p_total_amount, v_calc_total;
    END IF;

    -- Payment declarations breakdown
    FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS y(
        "channel" TEXT,
        "declaredAmount" NUMERIC,
        "externalRef" TEXT,
        "notes" TEXT
    )
    LOOP
        IF v_payment."declaredAmount" < 0 THEN
            RAISE EXCEPTION 'INVALID_PAYMENT: Declared amount cannot be negative';
        END IF;

        IF v_payment."channel" NOT IN ('cash', 'mpesa_company_till', 'mpesa_employee_phone', 'bank_transfer', 'credit') THEN
            RAISE EXCEPTION 'INVALID_PAYMENT_CHANNEL: Channel % is invalid', v_payment."channel";
        END IF;

        IF v_payment."channel" = 'cash' THEN
            v_cash_declared := v_cash_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'mpesa_employee_phone' THEN
            v_emp_mpesa_declared := v_emp_mpesa_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'mpesa_company_till' THEN
            v_till_mpesa_declared := v_till_mpesa_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'bank_transfer' THEN
            v_bank_declared := v_bank_declared + v_payment."declaredAmount";
            v_calc_declared_paid := v_calc_declared_paid + v_payment."declaredAmount";
        ELSIF v_payment."channel" = 'credit' THEN
            v_credit_declared := v_credit_declared + v_payment."declaredAmount";
        END IF;
    END LOOP;

    IF p_total_declared_paid IS NOT NULL AND ABS(p_total_declared_paid - v_calc_declared_paid) > 0.01 THEN
        RAISE EXCEPTION 'DECLARED_PAID_MISMATCH: Submitted declared paid % != calculated money payments %',
            p_total_declared_paid, v_calc_declared_paid;
    END IF;

    IF v_calc_declared_paid > v_calc_total THEN
        RAISE EXCEPTION 'OVERPAYMENT_NOT_ALLOWED: Declared money received (%) exceeds invoice total (%)', v_calc_declared_paid, v_calc_total;
    END IF;

    -- Credit is an explicit authorization for exactly the unpaid remainder; it is never money received.
    v_calc_outstanding := v_calc_total - v_calc_declared_paid;
    IF v_calc_outstanding > 0.00 AND ABS(v_credit_declared - v_calc_outstanding) > 0.01 THEN
        RAISE EXCEPTION 'CREDIT_DECLARATION_MISMATCH: Explicit credit amount (%) must equal the outstanding amount (%)', v_credit_declared, v_calc_outstanding;
    END IF;
    IF v_calc_outstanding = 0.00 AND v_credit_declared > 0.01 THEN
        RAISE EXCEPTION 'UNNECESSARY_CREDIT_DECLARATION: Credit cannot be declared when invoice is fully paid';
    END IF;
    IF p_outstanding_balance IS NOT NULL AND ABS(p_outstanding_balance - v_calc_outstanding) > 0.01 THEN
        RAISE EXCEPTION 'BALANCE_MISMATCH: Submitted outstanding % != calculated balance % (% - %)',
            p_outstanding_balance, v_calc_outstanding, v_calc_total, v_calc_declared_paid;
    END IF;

    -- Derived payment status
    IF v_calc_declared_paid >= v_calc_total THEN
        v_derived_status := 'fully_paid';
    ELSIF v_calc_declared_paid > 0 THEN
        v_derived_status := 'partially_paid';
    ELSIF v_credit_declared > 0 THEN
        v_derived_status := 'credit';
    ELSE
        v_derived_status := 'unpaid';
    END IF;

    -- 7. CREDIT ACCOUNT CONCURRENCY-SAFE CHECK & LOCK
    IF v_calc_outstanding > 0 THEN
        IF NOT v_customer.is_credit_eligible THEN
            RAISE EXCEPTION 'CREDIT_NOT_AUTHORIZED: Customer % is not credit eligible for outstanding balance %',
                v_customer.name, v_calc_outstanding;
        END IF;

        -- Lock customer credit account row
        SELECT customer_id, current_balance, total_credit_extended
        INTO v_credit_acc
        FROM credit_accounts
        WHERE customer_id = p_customer_id
        FOR UPDATE;

        IF v_credit_acc.customer_id IS NULL THEN
            INSERT INTO credit_accounts (customer_id, current_balance, total_credit_extended)
            VALUES (p_customer_id, 0.00, 0.00)
            RETURNING customer_id, current_balance, total_credit_extended INTO v_credit_acc;
        END IF;

        IF v_credit_acc.current_balance + v_calc_outstanding > v_customer.credit_limit THEN
            RAISE EXCEPTION 'CREDIT_LIMIT_EXCEEDED: Credit purchase of % brings balance % over limit %',
                v_calc_outstanding, v_credit_acc.current_balance + v_calc_outstanding, v_customer.credit_limit;
        END IF;

        UPDATE credit_accounts
        SET current_balance = current_balance + v_calc_outstanding,
            total_credit_extended = total_credit_extended + v_calc_outstanding,
            updated_at = timezone('utc', now())
        WHERE customer_id = p_customer_id;
    END IF;

    -- 8. INSERT DELIVERIES RECORD
    INSERT INTO deliveries (
        delivery_reference, client_tx_id, payload_hash, customer_id, created_by,
        vehicle_assignment_id, operational_status, payment_status, reconciliation_status,
        customer_confirmation_status, subtotal_amount, discount_amount, total_amount,
        total_declared_paid, outstanding_balance, delivery_lat, delivery_lng,
        gps_accuracy_m, device_captured_at, submitted_at, synced_at,
        is_offline_submission, notes
    ) VALUES (
        p_delivery_reference, p_client_tx_id, p_payload_hash, p_customer_id, p_created_by,
        p_vehicle_assignment_id, 'delivered', v_derived_status, 'pending_reconciliation',
        'pending', v_calc_subtotal, v_calc_discount, v_calc_total,
        v_calc_declared_paid, v_calc_outstanding, p_delivery_lat, p_delivery_lng,
        p_gps_accuracy_m, COALESCE(p_device_captured_at, timezone('utc', now())),
        timezone('utc', now()), timezone('utc', now()), p_is_offline_submission, p_notes
    )
    RETURNING id INTO v_delivery_id;

    -- 9. PROCESS LINE ITEMS, STOCK LOCKING & PHYSICAL HALF-SHEET TRANSFORMATION
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
        "productId" UUID,
        "sellingUnit" TEXT,
        "quantity" INT,
        "appliedUnitPrice" NUMERIC,
        "priceApprovalId" UUID
    )
    LOOP
        v_item_unit := v_item."sellingUnit"::selling_unit_enum;
        v_item_qty := v_item."quantity";

        -- Ensure the balance row exists, then lock it. ON CONFLICT handles concurrent
        -- first use of a product/location without allowing a duplicate balance row.
        INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
        VALUES (v_item."productId", v_source_location_id, 0, 0)
        ON CONFLICT (product_id, stock_location_id) DO NOTHING;

        SELECT full_sheets, half_sheets
        INTO v_avail_full, v_avail_halves
        FROM inventory_balances
        WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id
        FOR UPDATE;

        IF v_item_unit = 'FULL_SHEET' THEN
            IF v_avail_full < v_item_qty THEN
                RAISE EXCEPTION 'INSUFFICIENT_STOCK: Required % full sheets, but only % available at location %',
                    v_item_qty, v_avail_full, v_source_location_id;
            END IF;

            UPDATE inventory_balances
            SET full_sheets = full_sheets - v_item_qty, updated_at = timezone('utc', now())
            WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", v_source_location_id, NULL,
                -v_item_qty, 0, -v_item_qty * 1.0,
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );
        ELSE
            -- HALF_SHEET ordered sale
            v_order_halves := v_item_qty;
            v_halves_from_stock := LEAST(v_avail_halves, v_order_halves);
            v_shortage := v_order_halves - v_halves_from_stock;

            IF v_shortage > 0 THEN
                v_full_to_split := CEIL(v_shortage / 2.0)::INT;

                IF v_avail_full < v_full_to_split THEN
                    RAISE EXCEPTION 'INSUFFICIENT_STOCK: Order requires % half sheets. Only % half sheets in stock; splitting requires % full sheets, but only % full sheets available',
                        v_order_halves, v_avail_halves, v_full_to_split, v_avail_full;
                END IF;

                -- Record transformation
                INSERT INTO stock_transformations (
                    product_id, stock_location_id, full_sheets_consumed, half_sheets_produced, operator_id, notes
                ) VALUES (
                    v_item."productId", v_source_location_id, v_full_to_split, v_full_to_split * 2, p_created_by,
                    'Split transformation for delivery ' || p_delivery_reference
                ) RETURNING id INTO v_trans_id;

                -- Update balance: consume full sheets, produce 2x half sheets
                UPDATE inventory_balances
                SET full_sheets = full_sheets - v_full_to_split,
                    half_sheets = half_sheets + (v_full_to_split * 2),
                    updated_at = timezone('utc', now())
                WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

                -- Record transformation movement (fse delta = 0)
                INSERT INTO stock_movements (
                    product_id, from_location_id, to_location_id,
                    full_sheets_delta, half_sheets_delta, fse_delta,
                    movement_type, responsible_employee_id, transformation_id, notes
                ) VALUES (
                    v_item."productId", v_source_location_id, v_source_location_id,
                    -v_full_to_split, v_full_to_split * 2, 0.00,
                    'split_full_to_half', p_created_by, v_trans_id, 'Split transformation for delivery ' || p_delivery_reference
                );
            END IF;

            -- Deduct ordered half sheets
            UPDATE inventory_balances
            SET half_sheets = half_sheets - v_order_halves, updated_at = timezone('utc', now())
            WHERE product_id = v_item."productId" AND stock_location_id = v_source_location_id;

            -- Record customer delivery movement
            INSERT INTO stock_movements (
                product_id, from_location_id, to_location_id,
                full_sheets_delta, half_sheets_delta, fse_delta,
                movement_type, responsible_employee_id, delivery_id, notes
            ) VALUES (
                v_item."productId", v_source_location_id, NULL,
                0, -v_order_halves, -(v_order_halves * 0.5),
                'delivery_to_customer', p_created_by, v_delivery_id, 'Delivery ' || p_delivery_reference
            );
        END IF;

        -- Record line item
        INSERT INTO delivery_items (
            delivery_id, product_id, selling_unit, quantity, full_sheet_equivalent,
            official_unit_price, applied_unit_price, is_special_price, price_approval_id, line_total
        ) VALUES (
            v_delivery_id, v_item."productId", v_item_unit, v_item_qty,
            CASE WHEN v_item_unit = 'FULL_SHEET' THEN v_item_qty * 1.0 ELSE v_item_qty * 0.5 END,
            v_auth_unit_price, v_item."appliedUnitPrice",
            (v_item."appliedUnitPrice" != v_auth_unit_price),
            v_item."priceApprovalId",
            ROUND(v_item_qty * v_item."appliedUnitPrice", 2)
        );
    END LOOP;

    -- 10. INSERT PAYMENT DECLARATIONS
    FOR v_payment IN SELECT * FROM jsonb_to_recordset(p_payments) AS y(
        "channel" TEXT,
        "declaredAmount" NUMERIC,
        "externalRef" TEXT,
        "notes" TEXT
    )
    LOOP
        IF v_payment."declaredAmount" > 0 AND v_payment."channel" != 'credit' THEN
            INSERT INTO payment_declarations (
                delivery_id, channel, declared_amount, declared_by, external_ref, notes
            ) VALUES (
                v_delivery_id, v_payment."channel"::payment_channel_enum,
                v_payment."declaredAmount", p_created_by, v_payment."externalRef", v_payment."notes"
            );
        END IF;
    END LOOP;

    -- 11. RECORD EMPLOYEE TURNOVER LIABILITIES
    IF v_cash_declared > 0 OR v_emp_mpesa_declared > 0 THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(p_created_by::text || ':' || CURRENT_DATE::text, 0));
        SELECT id INTO v_turnover_id
        FROM employee_turnovers
        WHERE employee_id = p_created_by AND shift_date = CURRENT_DATE
        FOR UPDATE;

        IF v_turnover_id IS NOT NULL THEN
            UPDATE employee_turnovers
            SET cash_declared = cash_declared + v_cash_declared,
                personal_mpesa_declared = personal_mpesa_declared + v_emp_mpesa_declared,
                variance = (cash_remitted + mpesa_forwarded) - ((cash_declared + v_cash_declared) + (personal_mpesa_declared + v_emp_mpesa_declared))
            WHERE id = v_turnover_id;
        ELSE
            INSERT INTO employee_turnovers (
                employee_id, shift_date, cash_declared, personal_mpesa_declared,
                cash_remitted, mpesa_forwarded, variance
            ) VALUES (
                p_created_by, CURRENT_DATE, v_cash_declared, v_emp_mpesa_declared,
                0.00, 0.00, -(v_cash_declared + v_emp_mpesa_declared)
            );
        END IF;
    END IF;

    -- 12. NOTIFICATION OUTBOX QUEUEING
    SELECT STRING_AGG(
        di.quantity::TEXT || ' x ' ||
        CASE WHEN di.selling_unit = 'FULL_SHEET' THEN 'Full' ELSE 'Half' END ||
        ' ' || p.name,
        ', ' ORDER BY p.sku
    ) INTO v_item_summary
    FROM delivery_items di
    JOIN products p ON p.id = di.product_id
    WHERE di.delivery_id = v_delivery_id;

    v_sms_payload := 'TOKA GLASS ' || p_delivery_reference || E'\\n' ||
        'Items: ' || COALESCE(v_item_summary, 'Glass delivery') || E'\\n' ||
        'Total KES ' || TO_CHAR(v_calc_total, 'FM999,999,990.00') ||
        ' | Cash ' || TO_CHAR(v_cash_declared, 'FM999,999,990.00') ||
        ' | Company M-Pesa ' || TO_CHAR(v_till_mpesa_declared, 'FM999,999,990.00') ||
        ' | Employee M-Pesa ' || TO_CHAR(v_emp_mpesa_declared, 'FM999,999,990.00') ||
        ' | Bank ' || TO_CHAR(v_bank_declared, 'FM999,999,990.00') ||
        ' | Due KES ' || TO_CHAR(v_calc_outstanding, 'FM999,999,990.00') || E'\\n' ||
        'Reply 1 to confirm or 2 to dispute. Help: 0700000000';

    INSERT INTO notifications (
        delivery_id, customer_phone, channel, payload, status
    ) VALUES (
        v_delivery_id, v_customer.primary_phone, 'SMS', v_sms_payload, 'queued'
    );

    -- 13. RETURN SUCCESS
    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'delivery_id', v_delivery_id,
        'delivery_reference', p_delivery_reference,
        'total_amount', v_calc_total,
        'total_declared_paid', v_calc_declared_paid,
        'outstanding_balance', v_calc_outstanding,
        'payment_status', v_derived_status
    );
END;
$$;

CREATE OR REPLACE FUNCTION receive_stock_warehouse(
    p_product_id UUID,
    p_location_id UUID,
    p_full_sheets INT,
    p_half_sheets INT DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_operator_role user_role_enum;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Stock receipt requires an authenticated employee';
    END IF;

    SELECT role INTO v_operator_role FROM profiles WHERE id = v_operator_id AND is_active = true;
    IF v_operator_role IS NULL OR v_operator_role NOT IN ('owner', 'manager') THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Only owners and managers can receive stock into warehouse';
    END IF;

    PERFORM 1 FROM products WHERE id = p_product_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Active product required'; END IF;
    PERFORM 1 FROM stock_locations WHERE id = p_location_id AND is_active = true AND location_type = 'warehouse';
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_STOCK_LOCATION: Receipt destination must be an active warehouse'; END IF;

    IF p_full_sheets < 0 OR p_half_sheets < 0 OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_STOCK_QUANTITY: Quantities must be non-negative and non-zero';
    END IF;

    -- Update or insert inventory balance
    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, p_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + p_full_sheets,
        half_sheets = inventory_balances.half_sheets + p_half_sheets,
        updated_at = timezone('utc', now());

    -- Record stock movement
    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, NULL, p_location_id,
        p_full_sheets, p_half_sheets, (p_full_sheets * 1.0) + (p_half_sheets * 0.5),
        'stock_receipt', v_operator_id, p_notes
    );

    RETURN jsonb_build_object('success', true, 'received_full', p_full_sheets, 'received_half', p_half_sheets);
END;
$$;

CREATE OR REPLACE FUNCTION dispatch_stock_vehicle(
    p_product_id UUID,
    p_warehouse_id UUID,
    p_vehicle_location_id UUID,
    p_full_sheets INT,
    p_half_sheets INT DEFAULT 0,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_wh_full INT;
    v_wh_half INT;
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Stock dispatch requires an authenticated employee';
    END IF;
    PERFORM 1 FROM profiles WHERE id = v_operator_id AND is_active = true AND role IN ('owner', 'manager');
    IF NOT FOUND THEN RAISE EXCEPTION 'PERMISSION_DENIED: Only active owners or managers may dispatch stock'; END IF;

    PERFORM 1 FROM stock_locations WHERE id = p_warehouse_id AND is_active = true AND location_type = 'warehouse';
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_WAREHOUSE: Source must be an active warehouse'; END IF;
    PERFORM 1 FROM stock_locations sl JOIN vehicles v ON v.id = sl.vehicle_id
    WHERE sl.id = p_vehicle_location_id AND sl.is_active = true AND sl.location_type = 'truck' AND v.is_active = true AND v.status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_VEHICLE_LOCATION: Destination must belong to an active vehicle'; END IF;

    IF p_full_sheets < 0 OR p_half_sheets < 0 OR (p_full_sheets = 0 AND p_half_sheets = 0) THEN
        RAISE EXCEPTION 'INVALID_QUANTITY: Dispatch quantities must be positive';
    END IF;

    -- Lock warehouse balance
    SELECT full_sheets, half_sheets INTO v_wh_full, v_wh_half
    FROM inventory_balances
    WHERE product_id = p_product_id AND stock_location_id = p_warehouse_id
    FOR UPDATE;

    IF v_wh_full IS NULL OR v_wh_full < p_full_sheets OR v_wh_half < p_half_sheets THEN
        RAISE EXCEPTION 'INSUFFICIENT_WAREHOUSE_STOCK: Warehouse does not have sufficient stock to dispatch';
    END IF;

    -- Deduct warehouse balance
    UPDATE inventory_balances
    SET full_sheets = full_sheets - p_full_sheets,
        half_sheets = half_sheets - p_half_sheets,
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id AND stock_location_id = p_warehouse_id;

    -- Add to vehicle stock balance
    INSERT INTO inventory_balances (product_id, stock_location_id, full_sheets, half_sheets)
    VALUES (p_product_id, p_vehicle_location_id, p_full_sheets, p_half_sheets)
    ON CONFLICT (product_id, stock_location_id) DO UPDATE
    SET full_sheets = inventory_balances.full_sheets + p_full_sheets,
        half_sheets = inventory_balances.half_sheets + p_half_sheets,
        updated_at = timezone('utc', now());

    -- Record transfer stock movement
    INSERT INTO stock_movements (
        product_id, from_location_id, to_location_id,
        full_sheets_delta, half_sheets_delta, fse_delta,
        movement_type, responsible_employee_id, notes
    ) VALUES (
        p_product_id, p_warehouse_id, p_vehicle_location_id,
        p_full_sheets, p_half_sheets, (p_full_sheets * 1.0) + (p_half_sheets * 0.5),
        'dispatch_to_truck', v_operator_id, p_notes
    );

    RETURN jsonb_build_object('success', true, 'dispatched_full', p_full_sheets, 'dispatched_half', p_half_sheets);
END;
$$;

CREATE OR REPLACE FUNCTION record_customer_collection(
    p_customer_id UUID,
    p_channel payment_channel_enum,
    p_amount NUMERIC,
    p_external_ref TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_collector_id UUID;
    v_ref TEXT;
    v_collection_id UUID;
    v_turnover_id UUID;
BEGIN
    v_collector_id := auth.uid();
    IF v_collector_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Collection recording requires an authenticated employee';
    END IF;
    PERFORM 1 FROM profiles WHERE id = v_collector_id AND is_active = true
      AND role IN ('owner', 'manager', 'cash_collector', 'accountant', 'salesperson', 'driver');
    IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: User cannot record customer collections'; END IF;

    PERFORM 1 FROM customers WHERE id = p_customer_id AND is_active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: Active customer required for collection'; END IF;
    IF p_channel = 'credit' THEN RAISE EXCEPTION 'INVALID_COLLECTION_CHANNEL: Credit is not money received'; END IF;
    IF p_amount <> ROUND(p_amount, 2) THEN RAISE EXCEPTION 'INVALID_AMOUNT_PRECISION: Collection supports at most two decimals'; END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_AMOUNT: Collection amount must be positive';
    END IF;

    -- Generate reference: COL-YYYYMM-XXXX
    v_ref := 'COL-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(FLOOR(RANDOM() * 9000 + 1000)::TEXT, 4, '0');

    INSERT INTO collections (
        collection_reference, customer_id, collected_by, channel,
        total_amount, allocated_amount, unallocated_amount, external_ref, notes
    ) VALUES (
        v_ref, p_customer_id, v_collector_id, p_channel,
        p_amount, 0.00, p_amount, p_external_ref, p_notes
    ) RETURNING id INTO v_collection_id;

    -- If cash or personal m-pesa, update turnover liability
    IF p_channel IN ('cash', 'mpesa_employee_phone') THEN
        PERFORM pg_advisory_xact_lock(hashtextextended(v_collector_id::text || ':' || CURRENT_DATE::text, 0));
        SELECT id INTO v_turnover_id
        FROM employee_turnovers
        WHERE employee_id = v_collector_id AND shift_date = CURRENT_DATE
        FOR UPDATE;

        IF v_turnover_id IS NOT NULL THEN
            UPDATE employee_turnovers
            SET cash_declared = cash_declared + (CASE WHEN p_channel = 'cash' THEN p_amount ELSE 0 END),
                personal_mpesa_declared = personal_mpesa_declared + (CASE WHEN p_channel = 'mpesa_employee_phone' THEN p_amount ELSE 0 END),
                variance = (cash_remitted + mpesa_forwarded) - (cash_declared + (CASE WHEN p_channel = 'cash' THEN p_amount ELSE 0 END) + personal_mpesa_declared + (CASE WHEN p_channel = 'mpesa_employee_phone' THEN p_amount ELSE 0 END))
            WHERE id = v_turnover_id;
        ELSE
            INSERT INTO employee_turnovers (
                employee_id, shift_date, cash_declared, personal_mpesa_declared, cash_remitted, mpesa_forwarded, variance
            ) VALUES (
                v_collector_id, CURRENT_DATE,
                (CASE WHEN p_channel = 'cash' THEN p_amount ELSE 0 END),
                (CASE WHEN p_channel = 'mpesa_employee_phone' THEN p_amount ELSE 0 END),
                0.00, 0.00, -p_amount
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'collection_id', v_collection_id,
        'collection_reference', v_ref,
        'total_amount', p_amount,
        'unallocated_amount', p_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION allocate_collection_invoice(
    p_collection_id UUID,
    p_delivery_id UUID,
    p_amount NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_operator_id UUID;
    v_collection RECORD;
    v_delivery RECORD;
    v_credit_balance NUMERIC(14,2);
BEGIN
    v_operator_id := auth.uid();
    IF v_operator_id IS NULL THEN
        RAISE EXCEPTION 'UNAUTHENTICATED: Invoice allocation requires an authenticated employee';
    END IF;
    PERFORM 1 FROM profiles WHERE id = v_operator_id AND is_active = true AND role IN ('owner', 'manager', 'accountant');
    IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_AUTHORIZED: User cannot allocate customer collections'; END IF;
    IF p_amount <> ROUND(p_amount, 2) THEN RAISE EXCEPTION 'INVALID_ALLOCATION_PRECISION: Allocation supports at most two decimal places'; END IF;

    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: Allocation amount must be positive';
    END IF;

    -- Lock collection
    SELECT * INTO v_collection
    FROM collections
    WHERE id = p_collection_id
    FOR UPDATE;

    IF v_collection.id IS NULL THEN
        RAISE EXCEPTION 'COLLECTION_NOT_FOUND: Collection does not exist';
    END IF;

    IF v_collection.unallocated_amount < p_amount THEN
        RAISE EXCEPTION 'INSUFFICIENT_UNALLOCATED_FUNDS: Collection has % unallocated, cannot allocate %',
            v_collection.unallocated_amount, p_amount;
    END IF;

    -- Lock delivery
    SELECT * INTO v_delivery
    FROM deliveries
    WHERE id = p_delivery_id
    FOR UPDATE;

    IF v_delivery.id IS NULL THEN
        RAISE EXCEPTION 'DELIVERY_NOT_FOUND: Delivery invoice does not exist';
    END IF;

    IF v_delivery.customer_id != v_collection.customer_id THEN
        RAISE EXCEPTION 'CUSTOMER_MISMATCH: Collection customer does not match invoice customer';
    END IF;

    IF v_delivery.outstanding_balance < p_amount THEN
        RAISE EXCEPTION 'EXCESS_ALLOCATION: Invoice balance is %, cannot allocate %',
            v_delivery.outstanding_balance, p_amount;
    END IF;

    -- Lock and validate the customer's receivable account before applying the allocation.
    SELECT current_balance INTO v_credit_balance
    FROM credit_accounts
    WHERE customer_id = v_collection.customer_id
    FOR UPDATE;
    IF NOT FOUND OR v_credit_balance < p_amount THEN
        RAISE EXCEPTION 'CREDIT_BALANCE_MISMATCH: Customer credit ledger cannot support allocation of %', p_amount;
    END IF;

    -- Collection amount and ownership remain immutable; only explicit allocation fields may change here.
    PERFORM set_config('toka.allow_collection_balance_update', 'on', true);

    -- Update collection
    UPDATE collections
    SET allocated_amount = allocated_amount + p_amount,
        unallocated_amount = unallocated_amount - p_amount,
        is_fully_allocated = (unallocated_amount - p_amount = 0)
    WHERE id = p_collection_id;

    -- Balance changes are allowed only inside this validated allocation transaction.
    PERFORM set_config('toka.allow_collection_balance_update', 'on', true);

    -- Update delivery outstanding balance
    UPDATE deliveries
    SET outstanding_balance = outstanding_balance - p_amount,
        payment_status = (CASE WHEN outstanding_balance - p_amount = 0 THEN 'fully_paid' ELSE 'partially_paid' END)::payment_status_enum
    WHERE id = p_delivery_id;

    -- Update credit account balance
    UPDATE credit_accounts
    SET current_balance = current_balance - p_amount,
        total_credit_repaid = total_credit_repaid + p_amount,
        last_payment_date = timezone('utc', now()),
        updated_at = timezone('utc', now())
    WHERE customer_id = v_collection.customer_id;

    -- Insert allocation record
    INSERT INTO audit_logs (actor_id, action_type, entity_name, entity_id, payload_after)
    VALUES (v_operator_id, 'COLLECTION_ALLOCATED', 'collections', p_collection_id,
            jsonb_build_object('delivery_id', p_delivery_id, 'amount', p_amount));

    INSERT INTO payment_allocations (
        collection_id, delivery_id, allocated_amount, allocated_by
    ) VALUES (
        p_collection_id, p_delivery_id, p_amount, v_operator_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'allocated_amount', p_amount,
        'remaining_collection_unallocated', v_collection.unallocated_amount - p_amount,
        'remaining_invoice_balance', v_delivery.outstanding_balance - p_amount
    );
END;
$$;

CREATE OR REPLACE FUNCTION process_inbound_sms_atomic(
    p_provider_message_id TEXT,
    p_sender_phone TEXT,
    p_raw_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inbound_id UUID;
    v_delivery RECORD;
    v_customer RECORD;
    v_upper_text TEXT;
    v_ref_match TEXT;
    v_is_confirm BOOLEAN;
    v_is_dispute BOOLEAN;
    v_category dispute_category_enum := 'other';
    v_event_type TEXT;
    v_code TEXT;
    v_pending_count INTEGER := 0;
BEGIN
    -- Check deduplication
    SELECT id INTO v_inbound_id
    FROM inbound_sms_messages
    WHERE provider_message_id = p_provider_message_id;

    IF v_inbound_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    -- Insert raw inbound SMS
    INSERT INTO inbound_sms_messages (
        provider_message_id, sender_phone, raw_message_text, processing_status
    ) VALUES (
        p_provider_message_id, p_sender_phone, p_raw_text, 'received'
    ) RETURNING id INTO v_inbound_id;

    v_upper_text := UPPER(TRIM(p_raw_text));

    -- Extract explicit reference if present
    SELECT (regexp_matches(v_upper_text, '(GD-\d{6}-\d{4}|GD-\d{4,6})'))[1] INTO v_ref_match;

    IF v_ref_match IS NOT NULL THEN
        SELECT d.id, d.delivery_reference, d.customer_id, d.customer_confirmation_status,
               c.primary_phone, c.alt_phone, c.name AS customer_name
        INTO v_delivery
        FROM deliveries d
        JOIN customers c ON c.id = d.customer_id
        WHERE d.delivery_reference ILIKE v_ref_match
        FOR UPDATE OF d;

        IF v_delivery.id IS NULL THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'invalid_reference', failure_reason = 'Reference ' || v_ref_match || ' not found'
            WHERE id = v_inbound_id;

            RETURN jsonb_build_object('success', false, 'status', 'invalid_reference', 'reference', v_ref_match);
        END IF;

        -- Strict sender phone verification
        IF v_delivery.primary_phone != p_sender_phone AND COALESCE(v_delivery.alt_phone, '') != p_sender_phone THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'failed',
                failure_reason = 'Unauthorized sender ' || p_sender_phone || ' for delivery ' || v_ref_match,
                matched_delivery_id = v_delivery.id
            WHERE id = v_inbound_id;

            INSERT INTO customer_confirmation_events (
                delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
            ) VALUES (
                v_delivery.id, v_inbound_id, p_sender_phone, 'UNAUTHORIZED', 'unauthorized_attempt', p_raw_text
            );

            RETURN jsonb_build_object('success', false, 'status', 'unauthorized_sender', 'reference', v_ref_match);
        END IF;
    ELSE
        -- Match customer by phone number
        SELECT id, name INTO v_customer
        FROM customers
        WHERE primary_phone = p_sender_phone OR alt_phone = p_sender_phone;

        IF v_customer.id IS NULL THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'unmatched', failure_reason = 'Sender not found in customer directory'
            WHERE id = v_inbound_id;

            RETURN jsonb_build_object('success', false, 'status', 'unmatched');
        END IF;

        -- Never guess which invoice a customer meant when multiple deliveries await a reply.
        SELECT COUNT(*) INTO v_pending_count
        FROM deliveries d
        WHERE d.customer_id = v_customer.id
          AND d.customer_confirmation_status IN ('pending', 'disputed')
          AND d.created_at >= timezone('utc', now()) - INTERVAL '72 hours';

        IF v_pending_count > 1 THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'ambiguous', failure_reason = 'Multiple deliveries require an explicit delivery reference'
            WHERE id = v_inbound_id;
            RETURN jsonb_build_object('success', true, 'status', 'ambiguous', 'pending_count', v_pending_count);
        END IF;

        SELECT d.id, d.delivery_reference, d.customer_id, d.customer_confirmation_status
        INTO v_delivery
        FROM deliveries d
        WHERE d.customer_id = v_customer.id
          AND d.customer_confirmation_status IN ('pending', 'disputed')
          AND d.created_at >= timezone('utc', now()) - INTERVAL '72 hours'
        ORDER BY d.created_at DESC
        LIMIT 1
        FOR UPDATE OF d;

        IF v_delivery.id IS NULL THEN
            UPDATE inbound_sms_messages
            SET processing_status = 'unmatched', failure_reason = 'No active pending/disputed deliveries for customer'
            WHERE id = v_inbound_id;

            RETURN jsonb_build_object('success', false, 'status', 'no_pending');
        END IF;
    END IF;

    -- Update inbound message matched delivery
    UPDATE inbound_sms_messages
    SET matched_delivery_id = v_delivery.id,
        processing_status = 'processed',
        processed_at = timezone('utc', now())
    WHERE id = v_inbound_id;

    -- State Machine
    -- A confirmed delivery cannot be changed by later ordinary replies.
    IF v_delivery.customer_confirmation_status = 'confirmed' THEN
        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, 'ALREADY_CONFIRMED', 'unrecognized', p_raw_text
        );
        RETURN jsonb_build_object('success', true, 'status', 'already_confirmed', 'delivery_reference', v_delivery.delivery_reference);
    END IF;

    -- 1. If delivery is ALREADY DISPUTED: incoming responses are questionnaire reasons!
    IF v_delivery.customer_confirmation_status = 'disputed' THEN
        IF v_upper_text ~ '(^|\s)(1|WRONG ITEM|QUANTITY|COUNT)($|\s)' THEN
            v_category := 'wrong_items_or_quantities';
        ELSIF v_upper_text ~ '(^|\s)(2|PRICE|RATE|OVERCHARGE)($|\s)' THEN
            v_category := 'incorrect_price';
        ELSIF v_upper_text ~ '(^|\s)(3|PAYMENT|CASH|MPESA|BALANCE)($|\s)' THEN
            v_category := 'wrong_payment_declared';
        ELSIF v_upper_text ~ '(^|\s)(4|NOT RECEIVED|NEVER RECEIVED)($|\s)' THEN
            v_category := 'delivery_never_received';
        ELSIF v_upper_text ~ '(^|\s)(5|DAMAGED|BROKEN|CRACK)($|\s)' THEN
            v_category := 'damaged_glass_uncredited';
        END IF;

        UPDATE customer_disputes
        SET dispute_category = v_category,
            customer_notes = customer_notes || ' | Follow-up SMS: ' || p_raw_text
        WHERE delivery_id = v_delivery.id AND is_active = true;

        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, 'CATEGORY_UPDATE', 'dispute_category_clarification', p_raw_text
        );

        RETURN jsonb_build_object(
            'success', true,
            'status', 'dispute_updated',
            'delivery_reference', v_delivery.delivery_reference,
            'category', v_category
        );
    END IF;

    -- 2. Delivery is awaiting initial response
    v_is_confirm := v_upper_text ~ '(^|\s)(1|YES|CONFIRM|CONFIRMED|SAWA)($|\s)';
    v_is_dispute := v_upper_text ~ '(^|\s)(2|NO|DISPUTE|PROBLEM|WRONG|HAPANA)($|\s)';

    IF v_is_confirm THEN
        PERFORM set_config('toka.allow_sms_status_transition', 'on', true);
        UPDATE deliveries
        SET customer_confirmation_status = 'confirmed'
        WHERE id = v_delivery.id;

        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, '1', 'confirmation', p_raw_text
        );

        INSERT INTO customer_confirmations (
            delivery_id, inbound_sms_id, reply_channel, response_code, sender_phone
        ) VALUES (
            v_delivery.id, v_inbound_id, 'SMS', '1', p_sender_phone
        ) ON CONFLICT (delivery_id) DO NOTHING;

        RETURN jsonb_build_object('success', true, 'status', 'confirmed', 'delivery_reference', v_delivery.delivery_reference);
    ELSIF v_is_dispute THEN
        PERFORM set_config('toka.allow_sms_status_transition', 'on', true);
        UPDATE deliveries
        SET customer_confirmation_status = 'disputed'
        WHERE id = v_delivery.id;

        -- Parse category if given in initial message (e.g., '2 3' or '2 price wrong')
        IF v_upper_text ~ '(2[\s\-_:]*1|WRONG ITEM|QUANTITY)' THEN
            v_category := 'wrong_items_or_quantities';
        ELSIF v_upper_text ~ '(2[\s\-_:]*2|PRICE|RATE|OVERCHARGE)' THEN
            v_category := 'incorrect_price';
        ELSIF v_upper_text ~ '(2[\s\-_:]*3|PAYMENT|CASH|MPESA)' THEN
            v_category := 'wrong_payment_declared';
        ELSIF v_upper_text ~ '(2[\s\-_:]*4|NOT RECEIVED|NEVER)' THEN
            v_category := 'delivery_never_received';
        ELSIF v_upper_text ~ '(2[\s\-_:]*5|DAMAGED|BROKEN|CRACK)' THEN
            v_category := 'damaged_glass_uncredited';
        END IF;

        INSERT INTO customer_disputes (
            delivery_id, customer_id, inbound_sms_id, dispute_category, customer_notes, is_active
        ) VALUES (
            v_delivery.id, v_delivery.customer_id, v_inbound_id, v_category, p_raw_text, true
        );

        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, '2', 'dispute', p_raw_text
        );

        INSERT INTO customer_confirmations (
            delivery_id, inbound_sms_id, reply_channel, response_code, sender_phone
        ) VALUES (
            v_delivery.id, v_inbound_id, 'SMS', '2', p_sender_phone
        ) ON CONFLICT (delivery_id) DO NOTHING;

        RETURN jsonb_build_object(
            'success', true,
            'status', 'disputed',
            'delivery_reference', v_delivery.delivery_reference,
            'category', v_category
        );
    ELSE
        INSERT INTO customer_confirmation_events (
            delivery_id, inbound_sms_id, sender_phone, response_code, event_type, raw_text
        ) VALUES (
            v_delivery.id, v_inbound_id, p_sender_phone, 'UNRECOGNIZED', 'unrecognized', p_raw_text
        );

        RETURN jsonb_build_object('success', false, 'status', 'unrecognized_intent', 'delivery_reference', v_delivery.delivery_reference);
    END IF;
END;
$$;


CREATE OR REPLACE FUNCTION resolve_customer_dispute(
  p_dispute_id UUID,
  p_resolution_notes TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_dispute customer_disputes%ROWTYPE;
BEGIN
  v_actor := auth.require_active_role(ARRAY['owner'::user_role_enum, 'manager'::user_role_enum]);
  IF p_resolution_notes IS NULL OR length(trim(p_resolution_notes)) < 5 THEN
    RAISE EXCEPTION 'RESOLUTION_NOTES_REQUIRED: Provide meaningful investigation and resolution notes';
  END IF;

  SELECT * INTO v_dispute
  FROM customer_disputes
  WHERE id = p_dispute_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'DISPUTE_NOT_FOUND'; END IF;
  IF NOT v_dispute.is_active THEN RAISE EXCEPTION 'DISPUTE_ALREADY_RESOLVED'; END IF;

  UPDATE customer_disputes
  SET is_active = false,
      investigated_by = v_actor,
      resolution_notes = trim(p_resolution_notes),
      resolved_at = timezone('utc', now())
  WHERE id = p_dispute_id;

  INSERT INTO audit_logs(actor_id, action_type, entity_name, entity_id, payload_before, payload_after)
  VALUES (
    v_actor, 'CUSTOMER_DISPUTE_RESOLVED', 'customer_disputes', p_dispute_id,
    jsonb_build_object('is_active', true, 'category', v_dispute.dispute_category),
    jsonb_build_object('is_active', false, 'resolution_notes', trim(p_resolution_notes))
  );

  RETURN jsonb_build_object('success', true, 'dispute_id', p_dispute_id, 'resolved_by', v_actor);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Function execution privileges: deny anonymous and direct client SMS writes
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION auth.get_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auth.get_user_role() TO authenticated;

REVOKE ALL ON FUNCTION auth.require_active_role(user_role_enum[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION auth.require_active_role(user_role_enum[]) TO authenticated;

REVOKE ALL ON FUNCTION submit_delivery_atomic(
  TEXT, UUID, TEXT, UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  payment_status_enum, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB, JSONB, UUID
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION submit_delivery_atomic(
  TEXT, UUID, TEXT, UUID, UUID, UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC,
  payment_status_enum, NUMERIC, NUMERIC, NUMERIC, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB, JSONB, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION receive_stock_warehouse(UUID, UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION receive_stock_warehouse(UUID, UUID, INTEGER, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION dispatch_stock_vehicle(UUID, UUID, UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION dispatch_stock_vehicle(UUID, UUID, UUID, INTEGER, INTEGER, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION record_customer_collection(UUID, payment_channel_enum, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION record_customer_collection(UUID, payment_channel_enum, NUMERIC, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION allocate_collection_invoice(UUID, UUID, NUMERIC) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION allocate_collection_invoice(UUID, UUID, NUMERIC) TO authenticated;

-- Only the trusted server-side webhook's service-role client can process provider replies.
REVOKE ALL ON FUNCTION process_inbound_sms_atomic(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION process_inbound_sms_atomic(TEXT, TEXT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION review_discount_approval(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION review_discount_approval(UUID, BOOLEAN, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION resolve_customer_dispute(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION resolve_customer_dispute(UUID, TEXT) TO authenticated;



-- ---------------------------------------------------------------------------
-- 8. Durable notification outbox claim procedure
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_pending_notifications(p_batch_size INTEGER DEFAULT 20)
RETURNS SETOF notifications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 100 THEN
    RAISE EXCEPTION 'INVALID_BATCH_SIZE';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT id
    FROM notifications
    WHERE (
      status = 'queued'
      OR (status = 'failed' AND COALESCE(next_retry_at, timezone('utc', now())) <= timezone('utc', now()))
      OR (status = 'sending' AND locked_at < timezone('utc', now()) - INTERVAL '10 minutes')
    )
      AND attempts < 6
    ORDER BY created_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE notifications n
  SET status = 'sending',
      attempts = n.attempts + 1,
      locked_at = timezone('utc', now()),
      last_error = NULL
  FROM candidates c
  WHERE n.id = c.id
  RETURNING n.*;
END;
$$;

REVOKE ALL ON FUNCTION claim_pending_notifications(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_pending_notifications(INTEGER) TO service_role;


-- ---------------------------------------------------------------------------
-- 9. Append-only collection/allocation and controlled customer balance ledgers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_collection_allocation_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.total_amount IS DISTINCT FROM NEW.total_amount
     OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
     OR OLD.collected_by IS DISTINCT FROM NEW.collected_by
     OR OLD.channel IS DISTINCT FROM NEW.channel
     OR OLD.external_ref IS DISTINCT FROM NEW.external_ref
     OR OLD.collection_reference IS DISTINCT FROM NEW.collection_reference THEN
    RAISE EXCEPTION 'IMMUTABLE_COLLECTION: Original collection identity and amount cannot be changed';
  END IF;

  IF (OLD.allocated_amount IS DISTINCT FROM NEW.allocated_amount
      OR OLD.unallocated_amount IS DISTINCT FROM NEW.unallocated_amount
      OR OLD.is_fully_allocated IS DISTINCT FROM NEW.is_fully_allocated)
     AND current_setting('toka.allow_collection_balance_update', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'CONTROLLED_COLLECTION_ALLOCATION_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_collection_allocation_update ON collections;
CREATE TRIGGER trg_guard_collection_allocation_update
BEFORE UPDATE ON collections
FOR EACH ROW EXECUTE FUNCTION guard_collection_allocation_update();

DROP TRIGGER IF EXISTS trg_no_update_payment_allocations ON payment_allocations;
CREATE TRIGGER trg_no_update_payment_allocations
BEFORE UPDATE OR DELETE ON payment_allocations
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_update();

DROP TRIGGER IF EXISTS trg_no_delete_collections ON collections;
CREATE TRIGGER trg_no_delete_collections
BEFORE DELETE ON collections
FOR EACH ROW EXECUTE FUNCTION prevent_immutable_delete();

DROP POLICY IF EXISTS "collections_update" ON collections;
DROP POLICY IF EXISTS collections_update ON collections;

-- ---------------------------------------------------------------------------
-- 10. Claim notifications safely for a server-side dispatcher
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 11. Close anonymous access and require an active employee role for internal
--     catalogue, customer, fleet and inventory reads.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE
  customers,
  customer_contacts,
  products,
  product_categories,
  customer_prices,
  vehicles,
  routes,
  vehicle_assignments,
  stock_locations,
  inventory_balances,
  stock_transformations,
  stock_movements,
  deliveries,
  delivery_items,
  payment_declarations,
  collections,
  payment_allocations,
  payment_reversals,
  employee_turnovers,
  inbound_sms_messages,
  customer_confirmations,
  customer_confirmation_events,
  customer_disputes,
  notifications,
  location_samples,
  audit_logs,
  transaction_corrections,
  credit_accounts,
  price_approval_requests,
  discount_approval_requests
FROM anon;

-- Make the intended authenticated read surface explicit rather than relying on
-- project-wide default grants. Row-level policies above still determine each row.
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE
  customers,
  customer_contacts,
  products,
  product_categories,
  customer_prices,
  vehicles,
  routes,
  vehicle_assignments,
  stock_locations,
  inventory_balances,
  stock_transformations,
  stock_movements,
  deliveries,
  delivery_items,
  payment_declarations,
  collections,
  payment_allocations,
  payment_reversals,
  employee_turnovers,
  inbound_sms_messages,
  customer_confirmations,
  customer_confirmation_events,
  customer_disputes,
  notifications,
  location_samples,
  audit_logs,
  transaction_corrections,
  credit_accounts,
  price_approval_requests,
  discount_approval_requests
TO authenticated;

-- Replace permissive catalogue policies inherited from the first RLS migration.
DROP POLICY IF EXISTS "customers_select_policy" ON customers;
CREATE POLICY customers_select_authenticated ON customers
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'cash_collector', 'accountant'
));

DROP POLICY IF EXISTS "customer_contacts_select" ON customer_contacts;
CREATE POLICY customer_contacts_select_authenticated ON customer_contacts
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'cash_collector', 'accountant'
));

DROP POLICY IF EXISTS "products_select_all" ON products;
CREATE POLICY products_select_authenticated ON products
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'cash_collector', 'accountant'
));

DROP POLICY IF EXISTS "categories_select_all" ON product_categories;
CREATE POLICY categories_select_authenticated ON product_categories
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'cash_collector', 'accountant'
));

DROP POLICY IF EXISTS "customer_prices_select" ON customer_prices;
CREATE POLICY customer_prices_select_authenticated ON customer_prices
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'cash_collector', 'accountant'
));

DROP POLICY IF EXISTS "vehicles_select" ON vehicles;
CREATE POLICY vehicles_select_authenticated ON vehicles
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'accountant'
));

DROP POLICY IF EXISTS "routes_select" ON routes;
CREATE POLICY routes_select_authenticated ON routes
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'accountant'
));

DROP POLICY IF EXISTS "stock_locations_select" ON stock_locations;
CREATE POLICY stock_locations_select_authenticated ON stock_locations
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'accountant'
));

DROP POLICY IF EXISTS "inventory_balances_select" ON inventory_balances;
CREATE POLICY inventory_balances_select_authenticated ON inventory_balances
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'accountant'
));

DROP POLICY IF EXISTS "stock_transformations_select" ON stock_transformations;
CREATE POLICY stock_transformations_select_authenticated ON stock_transformations
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'accountant'
));

DROP POLICY IF EXISTS "stock_movements_select" ON stock_movements;
CREATE POLICY stock_movements_select_authenticated ON stock_movements
FOR SELECT TO authenticated
USING (auth.get_user_role() IN (
  'owner', 'manager', 'salesperson', 'driver', 'accountant'
));

-- Location telemetry may only be submitted for the authenticated employee's own
-- account; an allowed role alone must not permit employee_id impersonation.
DROP POLICY IF EXISTS "location_samples_insert" ON location_samples;
CREATE POLICY location_samples_insert_self ON location_samples
FOR INSERT TO authenticated
WITH CHECK (
  employee_id = auth.uid()
  AND auth.get_user_role() IN ('owner', 'manager', 'salesperson', 'driver')
);

COMMIT;
