-- ============================================================================
-- Nessoo — Master Inventory Dashboard
-- Standalone schema for NEW Supabase project (separate from voucher platform)
-- Paste this into your new Supabase project's SQL Editor
-- ============================================================================


-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- rental_clients: each client = one property owner / management company
CREATE TABLE rental_clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  contact_name    text,
  contact_email   text,
  contact_phone   text,
  unit_count      int DEFAULT 0,
  notes           text,
  google_sheet_id text,
  sheet_tab_name  text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- rental_listings: individual units / inventory rows
CREATE TABLE rental_listings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES rental_clients(id) ON DELETE CASCADE,
  address             text NOT NULL,
  unit                text,
  price               int NOT NULL,
  bedrooms            int NOT NULL DEFAULT 0,
  bathrooms           numeric(3,1) NOT NULL DEFAULT 1,
  neighborhood        text,
  borough             text,
  security_deposit    int,
  features            text[] DEFAULT '{}',
  income_requirement  text,
  credit_score_min    int,
  availability_date   date,
  days_on_market      int DEFAULT 0,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'rented', 'pending', 'inactive')),
  is_published        boolean DEFAULT false,
  source              text DEFAULT 'manual',
  external_id         text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- rental_sync_log: audit trail for Google Sheets syncs
CREATE TABLE rental_sync_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid REFERENCES rental_clients(id),
  sync_type       text NOT NULL,
  rows_synced     int DEFAULT 0,
  rows_added      int DEFAULT 0,
  rows_updated    int DEFAULT 0,
  rows_removed    int DEFAULT 0,
  status          text NOT NULL DEFAULT 'success',
  error_message   text,
  created_at      timestamptz DEFAULT now()
);


-- ============================================================================
-- 2. INDEXES
-- ============================================================================

CREATE INDEX idx_rental_listings_client ON rental_listings(client_id);
CREATE INDEX idx_rental_listings_neighborhood ON rental_listings(neighborhood);
CREATE INDEX idx_rental_listings_status ON rental_listings(status);
CREATE INDEX idx_rental_listings_price ON rental_listings(price);
CREATE INDEX idx_rental_listings_bedrooms ON rental_listings(bedrooms);
CREATE INDEX idx_rental_listings_published ON rental_listings(is_published);

-- Full-text search (trigger-based since generated columns require immutable expressions)
ALTER TABLE rental_listings ADD COLUMN fts tsvector;
CREATE INDEX idx_rental_listings_fts ON rental_listings USING gin(fts);

CREATE OR REPLACE FUNCTION update_rental_fts()
RETURNS trigger AS $$
BEGIN
  NEW.fts := to_tsvector('english',
    coalesce(NEW.address, '') || ' ' ||
    coalesce(NEW.unit, '') || ' ' ||
    coalesce(NEW.neighborhood, '') || ' ' ||
    coalesce(NEW.borough, '') || ' ' ||
    coalesce(array_to_string(NEW.features, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_rental_fts BEFORE INSERT OR UPDATE ON rental_listings
  FOR EACH ROW EXECUTE FUNCTION update_rental_fts();


-- ============================================================================
-- 3. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE rental_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_sync_log ENABLE ROW LEVEL SECURITY;

-- All authenticated users can manage rental data (internal dashboard)
CREATE POLICY "Authenticated users manage rental_clients"
  ON rental_clients FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage rental_listings"
  ON rental_listings FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users manage sync_log"
  ON rental_sync_log FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Public can read published active listings (for the Nessoo marketplace)
CREATE POLICY "Public read published listings"
  ON rental_listings FOR SELECT TO anon
  USING (is_published = true AND status = 'active');


-- ============================================================================
-- 4. TRIGGERS
-- ============================================================================

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON rental_clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON rental_listings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-update client unit_count when listings change
CREATE OR REPLACE FUNCTION update_client_unit_count()
RETURNS trigger AS $$
BEGIN
  UPDATE rental_clients SET unit_count = (
    SELECT count(*) FROM rental_listings
    WHERE client_id = COALESCE(NEW.client_id, OLD.client_id)
  ) WHERE id = COALESCE(NEW.client_id, OLD.client_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_unit_count
  AFTER INSERT OR UPDATE OR DELETE ON rental_listings
  FOR EACH ROW EXECUTE FUNCTION update_client_unit_count();
