-- ============================================================================
-- Nessoo — Renter Tracking
-- Tables for managing renters and their unit matches
-- Paste into Supabase SQL Editor
-- ============================================================================

-- renters: people looking for apartments
CREATE TABLE renters (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  email                   text,
  phone                   text,
  budget_min              int,
  budget_max              int,
  bedrooms_needed         int,
  preferred_neighborhoods text[] DEFAULT '{}',
  move_in_date            date,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'placed', 'inactive')),
  notes                   text,
  source                  text DEFAULT 'manual',
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- renter_matches: tracks which units are sent to which renter
CREATE TABLE renter_matches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  renter_id   uuid NOT NULL REFERENCES renters(id) ON DELETE CASCADE,
  listing_id  uuid NOT NULL REFERENCES rental_listings(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'sent'
                CHECK (status IN ('sent', 'interested', 'applied', 'leased')),
  notes       text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(renter_id, listing_id)
);

-- Indexes
CREATE INDEX idx_renters_status ON renters(status);
CREATE INDEX idx_renter_matches_renter ON renter_matches(renter_id);
CREATE INDEX idx_renter_matches_listing ON renter_matches(listing_id);
CREATE INDEX idx_renter_matches_status ON renter_matches(status);

-- RLS
ALTER TABLE renters ENABLE ROW LEVEL SECURITY;
ALTER TABLE renter_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon manage renters" ON renters FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage renters" ON renters FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Anon manage renter_matches" ON renter_matches FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Auth manage renter_matches" ON renter_matches FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON renters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON renter_matches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
