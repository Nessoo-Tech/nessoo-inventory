-- ============================================================================
-- Nessoo / VryfID Exchange — Voucher Matching Platform
-- Complete Supabase Schema
-- ============================================================================
-- Paste this entire file into the Supabase SQL Editor and run it once.
-- ============================================================================


-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- organizations
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN ('housing_program', 'management_company')),
  created_at  timestamptz DEFAULT now()
);

-- profiles (extends auth.users)
CREATE TABLE profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text NOT NULL,
  full_name       text,
  role            text NOT NULL CHECK (role IN ('caseworker', 'landlord', 'admin')),
  organization_id uuid REFERENCES organizations(id),
  invited_by      uuid REFERENCES profiles(id),
  created_at      timestamptz DEFAULT now()
);

-- households
CREATE TABLE households (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  caseworker_id         uuid NOT NULL REFERENCES profiles(id),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  head_of_household     text NOT NULL,
  household_members     int NOT NULL DEFAULT 1,
  voucher_program       text NOT NULL,
  voucher_status        text NOT NULL CHECK (voucher_status IN ('Active', 'Expired', 'Pending Renewal')),
  voucher_expiration    date,
  authorized_bedrooms   text NOT NULL,
  employment_status     text,
  monthly_income        int DEFAULT 0,
  ssi_ssdi_amount       int DEFAULT 0,
  tenant_contribution   int DEFAULT 0,
  max_rent              int DEFAULT 0,
  documents             text[] DEFAULT '{}',
  preferred_neighborhoods text[] DEFAULT '{}',
  move_in_timeline      text DEFAULT 'Flexible',
  accessibility_needed  boolean DEFAULT false,
  accessibility_notes   text,
  notes                 text,
  stage                 text NOT NULL DEFAULT 'Incomplete' CHECK (stage IN ('Incomplete', 'Pending', 'Ready', 'Matched')),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- units
CREATE TABLE units (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landlord_id       uuid NOT NULL REFERENCES profiles(id),
  organization_id   uuid NOT NULL REFERENCES organizations(id),
  building_address  text NOT NULL,
  unit_number       text NOT NULL,
  bedrooms          int NOT NULL,
  bathrooms         numeric(3,1) NOT NULL,
  monthly_rent      int NOT NULL,
  accepted_programs text[] DEFAULT '{}',
  inspection_status text DEFAULT 'Needs Inspection',
  availability_date date,
  neighborhood      text,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- pipeline
CREATE TABLE pipeline (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES households(id),
  unit_id         uuid NOT NULL REFERENCES units(id),
  landlord_id     uuid NOT NULL REFERENCES profiles(id),
  caseworker_id   uuid NOT NULL REFERENCES profiles(id),
  stage           text NOT NULL DEFAULT 'Accepted' CHECK (stage IN ('Accepted', 'Submission', 'Inspection', 'Approval', 'Lease Signed')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE(household_id, unit_id)
);

-- invitations
CREATE TABLE invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  role            text NOT NULL CHECK (role IN ('caseworker', 'landlord')),
  organization_id uuid REFERENCES organizations(id),
  invited_by      uuid NOT NULL REFERENCES profiles(id),
  accepted_at     timestamptz,
  created_at      timestamptz DEFAULT now()
);


-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX idx_households_caseworker ON households(caseworker_id);
CREATE INDEX idx_households_stage ON households(stage);
CREATE INDEX idx_units_landlord ON units(landlord_id);
CREATE INDEX idx_pipeline_household ON pipeline(household_id);
CREATE INDEX idx_pipeline_unit ON pipeline(unit_id);
CREATE INDEX idx_pipeline_landlord ON pipeline(landlord_id);
CREATE INDEX idx_pipeline_caseworker ON pipeline(caseworker_id);
CREATE INDEX idx_invitations_email ON invitations(email);


-- ============================================================================
-- 3. ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 4. RLS POLICIES
-- ============================================================================

-- ---------- organizations ----------
CREATE POLICY "Authenticated users can read orgs"
  ON organizations FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins manage orgs"
  ON organizations FOR ALL TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ---------- profiles ----------
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Read same-org profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "Admins read all profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "System inserts profiles"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- ---------- households ----------
CREATE POLICY "Caseworkers see own households"
  ON households FOR SELECT TO authenticated
  USING (caseworker_id = auth.uid());

CREATE POLICY "Admins see all households"
  ON households FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Caseworkers insert households"
  ON households FOR INSERT TO authenticated
  WITH CHECK (caseworker_id = auth.uid());

CREATE POLICY "Caseworkers update own households"
  ON households FOR UPDATE TO authenticated
  USING (caseworker_id = auth.uid());

CREATE POLICY "Caseworkers delete own households"
  ON households FOR DELETE TO authenticated
  USING (caseworker_id = auth.uid());

-- ---------- units ----------
CREATE POLICY "Landlords see own units"
  ON units FOR SELECT TO authenticated
  USING (landlord_id = auth.uid());

CREATE POLICY "Admins see all units"
  ON units FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Landlords insert units"
  ON units FOR INSERT TO authenticated
  WITH CHECK (landlord_id = auth.uid());

CREATE POLICY "Landlords update own units"
  ON units FOR UPDATE TO authenticated
  USING (landlord_id = auth.uid());

CREATE POLICY "Landlords delete own units"
  ON units FOR DELETE TO authenticated
  USING (landlord_id = auth.uid());

-- ---------- pipeline ----------
CREATE POLICY "Landlords see own pipeline"
  ON pipeline FOR SELECT TO authenticated
  USING (landlord_id = auth.uid());

CREATE POLICY "Caseworkers see own pipeline"
  ON pipeline FOR SELECT TO authenticated
  USING (caseworker_id = auth.uid());

CREATE POLICY "Admins see all pipeline"
  ON pipeline FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Landlords insert pipeline"
  ON pipeline FOR INSERT TO authenticated
  WITH CHECK (landlord_id = auth.uid());

CREATE POLICY "Pipeline participants update"
  ON pipeline FOR UPDATE TO authenticated
  USING (
    landlord_id = auth.uid() OR caseworker_id = auth.uid()
  );

-- ---------- invitations ----------
CREATE POLICY "Admins manage invitations"
  ON invitations FOR ALL TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Users see own invitations"
  ON invitations FOR SELECT TO authenticated
  USING (
    email = (SELECT email FROM profiles WHERE id = auth.uid())
  );


-- ============================================================================
-- 5. AUTO-CREATE PROFILE ON SIGNUP (trigger on auth.users)
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
DECLARE
  inv RECORD;
BEGIN
  SELECT * INTO inv FROM invitations
  WHERE email = NEW.email AND accepted_at IS NULL
  ORDER BY created_at DESC LIMIT 1;

  INSERT INTO profiles (id, email, full_name, role, organization_id, invited_by)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(inv.role, 'caseworker'),
    inv.organization_id,
    inv.invited_by
  );

  IF inv.id IS NOT NULL THEN
    UPDATE invitations SET accepted_at = now() WHERE id = inv.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- ============================================================================
-- 6. MATCHING FUNCTION (SECURITY DEFINER)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_matches_for_unit(p_unit_id uuid)
RETURNS TABLE (
  household_id uuid,
  head_of_household text,
  household_members int,
  voucher_program text,
  voucher_status text,
  authorized_bedrooms text,
  employment_status text,
  monthly_income int,
  ssi_ssdi_amount int,
  tenant_contribution int,
  max_rent int,
  documents text[],
  preferred_neighborhoods text[],
  move_in_timeline text,
  accessibility_needed boolean,
  notes text,
  stage text,
  caseworker_id uuid,
  created_at timestamptz
)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    h.id AS household_id,
    h.head_of_household,
    h.household_members,
    h.voucher_program,
    h.voucher_status,
    h.authorized_bedrooms,
    h.employment_status,
    h.monthly_income,
    h.ssi_ssdi_amount,
    h.tenant_contribution,
    h.max_rent,
    h.documents,
    h.preferred_neighborhoods,
    h.move_in_timeline,
    h.accessibility_needed,
    h.notes,
    h.stage,
    h.caseworker_id,
    h.created_at
  FROM units u
  CROSS JOIN households h
  WHERE
    u.id = p_unit_id
    AND u.landlord_id = auth.uid()
    AND h.stage = 'Ready'
    AND (
      (h.authorized_bedrooms = 'Studio' AND u.bedrooms = 0) OR
      (h.authorized_bedrooms = '1BR' AND u.bedrooms = 1) OR
      (h.authorized_bedrooms = '2BR' AND u.bedrooms = 2) OR
      (h.authorized_bedrooms = '3BR' AND u.bedrooms = 3) OR
      (h.authorized_bedrooms = '4BR' AND u.bedrooms = 4)
    )
    AND h.max_rent >= u.monthly_rent
    AND (
      array_length(h.preferred_neighborhoods, 1) IS NULL
      OR u.neighborhood = ANY(h.preferred_neighborhoods)
    )
    AND (
      'Any' = ANY(u.accepted_programs)
      OR h.voucher_program = ANY(u.accepted_programs)
      OR (h.voucher_program = 'Section 8/HCV' AND 'Section 8' = ANY(u.accepted_programs))
    )
    AND NOT EXISTS (
      SELECT 1 FROM pipeline p
      WHERE p.household_id = h.id AND p.unit_id = u.id
    )
  ORDER BY array_length(h.documents, 1) DESC NULLS LAST;
$$;


-- ============================================================================
-- 7. UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON households FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON units FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON pipeline FOR EACH ROW EXECUTE FUNCTION update_updated_at();
