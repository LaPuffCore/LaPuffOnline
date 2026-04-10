-- ============================================================================
-- LA PUFF LOCATION & POINTS ATTRIBUTION SCHEMA
-- ============================================================================
-- Run this once in Supabase SQL Editor to set up tables, triggers, and RPC functions
-- ============================================================================

-- ─── 1. TRACK USER PARTICIPANT STATUS (cached in profile for fast lookups) ──────
-- Add columns to profiles table if they don't exist
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_nyc_ping_at TIMESTAMP NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_participant_status TEXT DEFAULT 'orbiter';

-- ─── 2. TRACK FAVORITE POINT CONTRIBUTIONS ────────────────────────────────────
-- This table tracks which users have already contributed points to which events
-- while in an active (signed-in + participant) state.
-- Primary key: (user_id, event_id) to ensure one contribution per event per user.
CREATE TABLE IF NOT EXISTS favorite_point_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  contributed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_fav_point_contribs_user 
  ON favorite_point_contributions(user_id);
CREATE INDEX IF NOT EXISTS idx_fav_point_contribs_event 
  ON favorite_point_contributions(event_id);

-- Enable RLS on favorite_point_contributions
ALTER TABLE favorite_point_contributions ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own contributions
CREATE POLICY "Users can read own contributions"
  ON favorite_point_contributions FOR SELECT
  USING (auth.uid() = user_id);

-- Allow the award_points_for_active_favorites RPC to insert (via service role)
CREATE POLICY "Service role can insert contributions"
  ON favorite_point_contributions FOR INSERT
  WITH CHECK (true);

-- ─── 3. RPC: AWARD POINTS FOR FAVORITES WHEN USER BECOMES PARTICIPANT ────────────
-- Called when user syncs their participant status while signed in.
-- Returns the number of events that received point contribution marks.
-- IMPORTANT: This RPC only marks contributions. Frontend calculates final points
-- and calls awardPoints() via pointsSystem.js to add to clout_points total.
CREATE OR REPLACE FUNCTION award_points_for_active_favorites(p_user_id UUID)
RETURNS INT AS $$
DECLARE
  v_event_id UUID;
  v_events_contributed INT := 0;
  v_event_record RECORD;
BEGIN
  -- Only allow if user is authenticated as themselves
  IF auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: Cannot award points for another user';
  END IF;

  -- 1. Find all events this user has favorited (via event_favorites)
  FOR v_event_record IN
    SELECT DISTINCT event_id
    FROM event_favorites
    WHERE user_id = p_user_id
  LOOP
    v_event_id := v_event_record.event_id;

    -- 2. Check if this user has already contributed points for this event
    IF NOT EXISTS (
      SELECT 1 FROM favorite_point_contributions
      WHERE user_id = p_user_id AND event_id = v_event_id
    ) THEN
      -- 3. Mark contribution (prevents future duplicate awards for this event)
      INSERT INTO favorite_point_contributions (user_id, event_id)
      VALUES (p_user_id, v_event_id)
      ON CONFLICT DO NOTHING;

      v_events_contributed := v_events_contributed + 1;
    END IF;
  END LOOP;

  -- Frontend will call awardPoints() with calculated amount based on returned count
  RETURN v_events_contributed;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── 4. MODIFIED TRIGGER: Only award points if event_favorites inserted ────────
-- The trigger NO LONGER awards points directly. Points are now awarded via
-- award_points_for_active_favorites when user becomes participant.
-- This trigger just handles count updates.

DROP TRIGGER IF EXISTS on_event_favorite_insert ON event_favorites;

CREATE OR REPLACE FUNCTION on_event_favorite_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Increment the universal fav_count
  UPDATE events
  SET fav_count = fav_count + 1
  WHERE id = NEW.event_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_event_favorite_insert
  AFTER INSERT ON event_favorites
  FOR EACH ROW
  EXECUTE FUNCTION on_event_favorite_insert();

-- ─── 5. DELETE TRIGGER: Only decrement count, no point removal ─────────────────

DROP TRIGGER IF EXISTS on_event_favorite_delete ON event_favorites;

CREATE OR REPLACE FUNCTION on_event_favorite_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Decrement the universal fav_count
  UPDATE events
  SET fav_count = GREATEST(0, fav_count - 1)
  WHERE id = OLD.event_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_event_favorite_delete
  AFTER DELETE ON event_favorites
  FOR EACH ROW
  EXECUTE FUNCTION on_event_favorite_delete();

-- ─── 6. VERIFY TABLES & COLUMNS ────────────────────────────────────────────────

-- Ensure events.fav_count exists (should already be there)
ALTER TABLE events ADD COLUMN IF NOT EXISTS fav_count INT DEFAULT 0;

-- Ensure clout_ledger exists for tracking points
-- (If it doesn't exist, you'll need to create it or map to your points system)
-- Fallback: If clout_ledger doesn't exist, the INSERT will be skipped and
-- points must be awarded via award_clout RPC separately.

-- ─── 7. GRANT PERMISSIONS ──────────────────────────────────────────────────────

-- Service role needs to manage contributions
GRANT INSERT, UPDATE, DELETE ON favorite_point_contributions TO postgres;

-- Users can call the RPC
GRANT EXECUTE ON FUNCTION award_points_for_active_favorites(UUID) TO authenticated;
