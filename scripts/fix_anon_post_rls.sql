-- ============================================================
-- LaPuffOnline — Anonymous Post Ownership Fix
-- Run this ONCE in the Supabase SQL Editor (admin/service-role access).
--
-- What this fixes:
--   1. Allows anonymous users (anon key) to INSERT into anon_device_interactions
--      so device ownership is recorded when a post is created.
--   2. Creates delete_anon_geopost(p_post_id, p_device_id) RPC — a
--      SECURITY DEFINER function that checks ownership via the
--      anon_device_interactions table (no header-forwarding needed).
-- ============================================================

-- ── 1. Allow anonymous inserts into anon_device_interactions ──────────────
-- Without this, recordAnonAuthorInteraction() fails silently → posts become
-- orphans that can never be deleted by their owner.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'anon_device_interactions'
      AND policyname = 'Allow anon to record authorship'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Allow anon to record authorship"
      ON anon_device_interactions
      FOR INSERT
      TO anon
      WITH CHECK (interaction_type = 'author')
    $policy$;
  END IF;
END;
$$;

-- ── 2. SECURITY DEFINER delete RPC ───────────────────────────────────────
-- The frontend calls this for anonymous deletions instead of a direct DELETE.
-- Accepts device_id as a SQL parameter — no x-device-id header needed.

CREATE OR REPLACE FUNCTION delete_anon_geopost(p_post_id uuid, p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  -- Post must exist and must be anonymous (null user_id).
  SELECT user_id INTO v_user_id
  FROM geoposts
  WHERE id = p_post_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Never let this RPC delete an authenticated user's post.
  IF v_user_id IS NOT NULL THEN
    RETURN false;
  END IF;

  -- Verify device ownership.
  IF NOT EXISTS (
    SELECT 1 FROM anon_device_interactions
    WHERE target_id = p_post_id
      AND device_id = p_device_id
      AND interaction_type = 'author'
  ) THEN
    RETURN false;
  END IF;

  -- Ownership confirmed — delete the post and its interactions.
  DELETE FROM anon_device_interactions WHERE target_id = p_post_id;
  DELETE FROM geoposts WHERE id = p_post_id AND user_id IS NULL;
  RETURN true;
END;
$$;

-- Grant execute to anon and authenticated roles.
GRANT EXECUTE ON FUNCTION delete_anon_geopost(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION delete_anon_geopost(uuid, text) TO authenticated;

-- Quick smoke test (should return false — post doesn't exist).
SELECT delete_anon_geopost('00000000-0000-0000-0000-000000000000'::uuid, 'test-device') AS smoke_test;
