-- ============================================================================
-- SMART EMERGENCY RESPONSE & DISASTER MANAGEMENT SYSTEM
-- SUPABASE POSTGRESQL RELATIONAL SCHEMA & MIGRATION
-- Migration Version: 20261009000000_emergency_response_schema.sql
-- Note: Canonical migration applied to Supabase project.
-- Matches backend/supabase/schema.sql for Supabase CLI & manual SQL Editor use.
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. DRIVER ACCOUNTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.driver_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile_number VARCHAR(20) NOT NULL,
    driver_name VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_driver_mobile UNIQUE (mobile_number)
);

CREATE INDEX IF NOT EXISTS idx_driver_mobile ON public.driver_accounts(mobile_number);
CREATE INDEX IF NOT EXISTS idx_driver_status ON public.driver_accounts(status);

-- ============================================================================
-- 2. RESPONSE UNITS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.response_units (
    id VARCHAR(20) PRIMARY KEY, -- e.g. AMB-01, FIR-01, RES-01
    driver_id UUID NOT NULL REFERENCES public.driver_accounts(id) ON DELETE RESTRICT,
    role VARCHAR(30) NOT NULL CHECK (role IN ('AMBULANCE', 'FIRE_BRIGADE', 'RESCUE_TEAM')),
    vehicle_number VARCHAR(30) NOT NULL,
    location_type VARCHAR(50) NOT NULL DEFAULT 'DECCAN_GYMKHANA',
    location_name VARCHAR(100) NOT NULL DEFAULT 'Deccan Gymkhana',
    lat DOUBLE PRECISION NOT NULL DEFAULT 18.5160,
    lon DOUBLE PRECISION NOT NULL DEFAULT 73.8400,
    node_id VARCHAR(50) DEFAULT 'Deccan_Gymkhana_D',
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('AVAILABLE', 'ASSIGNED', 'EN_ROUTE', 'BUSY', 'OFFLINE')),
    active_assignment_id VARCHAR(50) DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_online_at TIMESTAMPTZ,
    last_location_update_at TIMESTAMPTZ,
    CONSTRAINT uq_unit_vehicle UNIQUE (vehicle_number)
);

CREATE INDEX IF NOT EXISTS idx_units_driver ON public.response_units(driver_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON public.response_units(status);
CREATE INDEX IF NOT EXISTS idx_units_role ON public.response_units(role);

-- ============================================================================
-- 3. EMERGENCIES / DISASTERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.emergencies (
    id VARCHAR(50) PRIMARY KEY, -- e.g. E1001
    type VARCHAR(50) NOT NULL CHECK (type IN ('FIRE', 'MEDICAL', 'COLLAPSE', 'ACCIDENT', 'TRAFFIC_GRIDLOCK', 'HAZMAT', 'FLOOD')),
    priority VARCHAR(20) NOT NULL DEFAULT 'HIGH' CHECK (priority IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
    description TEXT,
    node_id VARCHAR(50) NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    injured_count INT NOT NULL DEFAULT 0,
    severity INT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'REPORTED' CHECK (status IN ('REPORTED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED')),
    allocated_team_id VARCHAR(20) REFERENCES public.response_units(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_emergencies_status ON public.emergencies(status);
CREATE INDEX IF NOT EXISTS idx_emergencies_priority ON public.emergencies(priority);
CREATE INDEX IF NOT EXISTS idx_emergencies_node ON public.emergencies(node_id);

-- ============================================================================
-- 4. ASSIGNMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.assignments (
    id VARCHAR(50) PRIMARY KEY, -- e.g. ASG-E1001-AMB01
    emergency_id VARCHAR(50) NOT NULL REFERENCES public.emergencies(id) ON DELETE CASCADE,
    team_id VARCHAR(20) NOT NULL REFERENCES public.response_units(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'ASSIGNED', 'DECLINED', 'COMPLETED', 'CANCELLED')),
    route_nodes JSONB DEFAULT '[]'::jsonb,
    distance_km DOUBLE PRECISION DEFAULT 0.0,
    eta_minutes INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assignments_emergency ON public.assignments(emergency_id);
CREATE INDEX IF NOT EXISTS idx_assignments_team ON public.assignments(team_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON public.assignments(status);

-- ============================================================================
-- 5. LOCATION HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.location_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id VARCHAR(20) NOT NULL REFERENCES public.response_units(id) ON DELETE CASCADE,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    node_id VARCHAR(50),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_location_history_unit_time ON public.location_history(unit_id, recorded_at DESC);

-- ============================================================================
-- 6. AUDIT / EVENT HISTORY TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_type_time ON public.audit_events(event_type, created_at DESC);

-- ============================================================================
-- 7. AUTOMATED UPDATED_AT TIMESTAMP TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_driver_accounts_updated_at ON public.driver_accounts;
CREATE TRIGGER trg_driver_accounts_updated_at
BEFORE UPDATE ON public.driver_accounts
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_response_units_updated_at ON public.response_units;
CREATE TRIGGER trg_response_units_updated_at
BEFORE UPDATE ON public.response_units
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_emergencies_updated_at ON public.emergencies;
CREATE TRIGGER trg_emergencies_updated_at
BEFORE UPDATE ON public.emergencies
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_assignments_updated_at ON public.assignments;
CREATE TRIGGER trg_assignments_updated_at
BEFORE UPDATE ON public.assignments
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 8. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE public.driver_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Backend Service Role has full administrative access:
DROP POLICY IF EXISTS service_role_all_drivers ON public.driver_accounts;
CREATE POLICY service_role_all_drivers ON public.driver_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_units ON public.response_units;
CREATE POLICY service_role_all_units ON public.response_units FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_emergencies ON public.emergencies;
CREATE POLICY service_role_all_emergencies ON public.emergencies FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_assignments ON public.assignments;
CREATE POLICY service_role_all_assignments ON public.assignments FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_location_history ON public.location_history;
CREATE POLICY service_role_all_location_history ON public.location_history FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_audit_events ON public.audit_events;
CREATE POLICY service_role_all_audit_events ON public.audit_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated driver access (own profile and active operational data):
DROP POLICY IF EXISTS driver_read_own_account ON public.driver_accounts;
CREATE POLICY driver_read_own_account ON public.driver_accounts FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS driver_read_units ON public.response_units;
CREATE POLICY driver_read_units ON public.response_units FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS driver_read_emergencies ON public.emergencies;
CREATE POLICY driver_read_emergencies ON public.emergencies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS driver_read_assignments ON public.assignments;
CREATE POLICY driver_read_assignments ON public.assignments FOR SELECT TO authenticated USING (true);

-- Anonymous / Command Center public monitor policies (read active emergencies and active units only):
DROP POLICY IF EXISTS anon_read_active_units ON public.response_units;
CREATE POLICY anon_read_active_units ON public.response_units FOR SELECT TO anon USING (status != 'OFFLINE');

DROP POLICY IF EXISTS anon_read_emergencies ON public.emergencies;
CREATE POLICY anon_read_emergencies ON public.emergencies FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS anon_read_assignments ON public.assignments;
CREATE POLICY anon_read_assignments ON public.assignments FOR SELECT TO anon USING (true);
