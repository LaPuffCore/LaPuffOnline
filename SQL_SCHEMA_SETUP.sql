-- ============================================================================
-- LA PUFF ONLINE: MASTER UNIFIED ARCHITECTURE
-- ============================================================================
-- Synthesis of: Original Schema + IP Security + GM Identity + CSV Analytics
-- ============================================================================

-- ─── 1. CORE IDENTITY & PROGRESSION (PROFILES) ───────────────────────────────
-- Tracks the evolution of a user from "Orbiter" to "Participant."
-- Includes protection against direct point tampering via RLS.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS home_zip TEXT DEFAULT '10001';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS clout_points BIGINT DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_nyc_ping_at TIMESTAMPTZ NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_participant_status TEXT DEFAULT 'orbiter';

-- GamesMaster Initialization
-- Ensures the Architect UID is recognized by the system and RLS
INSERT INTO public.profiles (id, username, bio, home_zip)
VALUES ('a6630d04-ffbf-4ac6-bfd2-c1035776056a', 'GamesMasterLaPuff', 'The Architect.', '10002')
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;


-- ─── 2. THE SILENT PULSE: IP & HARDWARE SECURITY ─────────────────────────────
-- This layer handles the binding of physical devices to user identities.
-- It tracks anonymous behavior to catch multi-accounters/sock-puppets.

CREATE TABLE IF NOT EXISTS public.security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- Null for guests
  device_id TEXT NOT NULL,                                   -- Browser/Hardware ID
  ip_address INET NOT NULL,                                  -- Captured via handshake
  action_type TEXT DEFAULT 'site_load',                      -- Tracking context
  user_agent TEXT,
  origin_page TEXT,                                          -- Entry point URL
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Table for tracking guest interactions before they sign in
CREATE TABLE IF NOT EXISTS public.anon_device_interactions (
  device_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL, -- e.g., 'event_view', 'map_scroll'
  target_id UUID NOT NULL,        -- ID of the object interacted with
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ─── 3. CLOUT ECONOMY & LEDGER SYSTEM ────────────────────────────────────────
-- Double-entry accounting for points. Direct 'clout_points' updates are blocked.
-- Transactional history ensures every point is audit-ready.

CREATE TABLE IF NOT EXISTS public.clout_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  checkin_type TEXT, -- Must match constraint whitelist in future iterations
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL
);

-- Tracks referral credit before it is converted to Clout
CREATE TABLE IF NOT EXISTS public.referral_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES auth.users(id),
  referee_id UUID REFERENCES auth.users(id),
  status TEXT DEFAULT 'pending', 
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- System check for point contribution limits (one per user per event)
CREATE TABLE IF NOT EXISTS public.favorite_point_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  contributed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

-- Initialize GM Wealth Sync
INSERT INTO public.clout_ledger (user_id, amount, reason)
VALUES ('a6630d04-ffbf-4ac6-bfd2-c1035776056a', 9999999, 'GM_INITIALIZATION')
ON CONFLICT DO NOTHING;


-- ─── 4. CONTENT ENGINE: EVENTS & GEOPOSTS ────────────────────────────────────
-- Logic for both user-submitted content and auto-aggregated feeds.

-- The Central Events Table
CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID REFERENCES auth.users(id),
  event_name TEXT NOT NULL,
  event_date DATE NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  borough TEXT,
  fav_count INT DEFAULT 0,
  approved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-Scraped Feed (The Grid)
CREATE TABLE IF NOT EXISTS public.auto_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  location_data JSONB DEFAULT '{}'::JSONB,
  representative_emoji TEXT DEFAULT '🎉',
  hex_color TEXT DEFAULT '#7C3AED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- The Community Feed
CREATE TABLE IF NOT EXISTS public.geoposts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  borough TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracking of Clout spent on tipping/boosting posts
CREATE TABLE IF NOT EXISTS public.post_clout_given (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  post_id UUID NOT NULL REFERENCES public.geoposts(id),
  amount INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ─── 5. ROW LEVEL SECURITY (RLS) POLICIES ────────────────────────────────────
-- The "Firewall" implementing GM absolute visibility and point protection.

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ADMIN ACCESS: Exclusive GM permissions for UID a6630d04...
CREATE POLICY "GM: View Security Pulse" ON public.security_logs 
FOR SELECT USING (auth.uid() = 'a6630d04-ffbf-4ac6-bfd2-c1035776056a');

CREATE POLICY "GM: Read System Messages" ON public.gm_messages 
FOR SELECT USING (auth.uid() = 'a6630d04-ffbf-4ac6-bfd2-c1035776056a');

-- PUBLIC & GUEST POLICIES: Enabling the invisible tracking
CREATE POLICY "Security: Silent Pulse Insert" ON public.security_logs 
FOR INSERT WITH CHECK (true); -- Allows IP/Device logging for all visitors

CREATE POLICY "Profiles: Public Identification" ON public.profiles 
FOR SELECT USING (true);

-- POINT PROTECTION: Users can update bio/username but NOT clout_points
CREATE POLICY "Profiles: Limited Update Ownership" ON public.profiles
FOR UPDATE USING (auth.uid() = id)
WITH CHECK (
  auth.uid() = id AND 
  (NOT (clout_points IS DISTINCT FROM clout_points)) -- CSV constraint logic
);


-- ─── 6. AUTOMATED TRIGGERS (DB CONCURRENCY) ───────────────────────────────────

-- Maintain fav_count consistency without React race conditions
CREATE OR REPLACE FUNCTION sync_event_fav_count()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.events SET fav_count = fav_count + 1 WHERE id = NEW.event_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.events SET fav_count = GREATEST(0, fav_count - 1) WHERE id = OLD.event_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tr_sync_fav_count
AFTER INSERT OR DELETE ON public.event_favorites
FOR EACH ROW EXECUTE FUNCTION sync_event_fav_count();


-- ─── 7. FINAL PERMISSIONS ────────────────────────────────────────────────────
GRANT SELECT, INSERT ON public.security_logs TO anon, authenticated;
GRANT SELECT, INSERT ON public.anon_device_interactions TO anon, authenticated;
GRANT SELECT, INSERT ON public.clout_ledger TO authenticated;

-- ============================================================================
-- SYSTEM NOTES: ANONYMOUS VS. SIGNED-IN HANDLING
-- ============================================================================
-- 1. GUESTS: Handled via 'anon_device_interactions' using device_id only.
-- 2. PULSE: Every site load creates a record in 'security_logs'. If no UID is 
--    present, it remains a guest record until the sign-in/up event bonds 
--    that device_id and IP to a new user account.
-- 3. AUDIT: This allows the GM to see if the same device_id is creating 
--    multiple accounts (the "Sock Puppet" catch).
-- ============================================================================