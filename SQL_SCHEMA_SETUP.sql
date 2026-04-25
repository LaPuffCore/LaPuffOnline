-- ============================================================================
-- LA PUFF ONLINE: MASTER UNIFIED ARCHITECTURE (UPDATED)
-- ============================================================================
-- Synthesis of: Original Schema + IP Security + GM Identity + CSV Analytics
-- Includes complete Geopost, Comments, and Reaction structures.
-- ============================================================================

-- Enable UUID extension if not already active
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── 1. CORE IDENTITY & PROGRESSION (PROFILES) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  bio VARCHAR,
  home_zip TEXT DEFAULT '10001',
  clout_points INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  referral_code TEXT DEFAULT SUBSTRING(REPLACE((gen_random_uuid())::TEXT, '-', '') FROM 1 FOR 8),
  referred_by_code TEXT,
  last_nyc_ping_at TIMESTAMP,
  last_participant_status TEXT DEFAULT 'orbiter'
);

-- GamesMaster Initialization
INSERT INTO public.profiles (id, username, bio, home_zip)
VALUES ('a6630d04-ffbf-4ac6-bfd2-c1035776056a', 'GamesMasterLaPuff', 'The Architect.', '10002')
ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;


-- ─── 2. THE SILENT PULSE: IP & HARDWARE SECURITY ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.security_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  device_id TEXT NOT NULL,
  ip_address INET NOT NULL,
  action_type TEXT DEFAULT 'site_load',
  user_agent TEXT,
  origin_page TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

CREATE TABLE IF NOT EXISTS public.anon_device_interactions (
  device_id TEXT NOT NULL,
  target_id UUID NOT NULL,
  interaction_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ─── 3. CLOUT ECONOMY & LEDGER SYSTEM ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clout_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event_id UUID,
  checkin_type TEXT,
  geopost_id UUID
);

CREATE TABLE IF NOT EXISTS public.referral_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES auth.users(id),
  new_user_id UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.favorite_point_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL,
  contributed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, event_id)
);

CREATE TABLE IF NOT EXISTS public.point_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  entity_id UUID NOT NULL,
  contribution_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Initialize GM Wealth Sync
INSERT INTO public.clout_ledger (user_id, amount, reason)
VALUES ('a6630d04-ffbf-4ac6-bfd2-c1035776056a', 9999999, 'GM_INITIALIZATION')
ON CONFLICT DO NOTHING;


-- ─── 4. CONTENT ENGINE: EVENTS ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,
  event_name TEXT NOT NULL,
  price_category TEXT,
  location_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  event_date DATE NOT NULL,
  event_time_utc TIMESTAMPTZ NOT NULL,
  relevant_links TEXT[] DEFAULT ARRAY[]::TEXT[],
  description VARCHAR,
  photos TEXT[] DEFAULT ARRAY[]::TEXT[],
  representative_emoji VARCHAR,
  hex_color VARCHAR,
  is_approved BOOLEAN DEFAULT FALSE,
  user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id),
  zip_code TEXT,
  fav_count INTEGER DEFAULT 0,
  trend_threshold_count INTEGER NOT NULL DEFAULT 0,
  trend_window_peak_count INTEGER NOT NULL DEFAULT 0,
  trend_window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  event_time_utc_end TIMESTAMPTZ,
  afters_address TEXT,
  afters_lat DOUBLE PRECISION,
  afters_lng DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS public.auto_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  description TEXT,
  price_category TEXT DEFAULT '$',
  location_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  event_date DATE NOT NULL,
  event_time_utc TIMESTAMPTZ,
  representative_emoji TEXT DEFAULT '🎉',
  hex_color TEXT DEFAULT '#7C3AED',
  photos TEXT[] DEFAULT ARRAY[]::TEXT[],
  relevant_links TEXT[] DEFAULT ARRAY[]::TEXT[],
  borough TEXT,
  is_approved BOOLEAN DEFAULT TRUE,
  fav_count INTEGER DEFAULT 0,
  source_site TEXT NOT NULL,
  source_url TEXT NOT NULL,
  external_id TEXT,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.event_attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  checkin_type TEXT DEFAULT 'main',
  UNIQUE(user_id, event_id, checkin_type)
);

CREATE TABLE IF NOT EXISTS public.event_favorites (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, event_id)
);


-- ─── 5. COMMUNITY FEED: GEOPOSTS & REACTIONS ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.geoposts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  content JSONB NOT NULL,
  image_url TEXT,
  zip_code TEXT,
  borough TEXT,
  is_participant BOOLEAN DEFAULT FALSE,
  post_approved BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  scope TEXT NOT NULL DEFAULT 'digital',
  post_fill TEXT,
  post_outline TEXT,
  post_shadow TEXT
);

CREATE TABLE IF NOT EXISTS public.post_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID REFERENCES public.geoposts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(post_id, user_id, emoji_text)
);

CREATE TABLE IF NOT EXISTS public.post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.geoposts(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES public.post_comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  username TEXT DEFAULT 'anonymous',
  content TEXT NOT NULL,
  is_participant BOOLEAN DEFAULT FALSE,
  borough TEXT,
  zip_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.comment_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id UUID NOT NULL REFERENCES public.post_comments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE(comment_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS public.post_clout_given (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES public.geoposts(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);


-- ─── 6. GM SYSTEMS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.gm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  sender_name TEXT,
  subject_title TEXT,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE
);


-- ─── 7. ROW LEVEL SECURITY (RLS) POLICIES ────────────────────────────────────

ALTER TABLE public.security_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gm_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auto_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geoposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comment_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clout_ledger ENABLE ROW LEVEL SECURITY;

-- GM Access
CREATE POLICY "GM: View Security Pulse" ON public.security_logs FOR SELECT USING (auth.uid() = 'a6630d04-ffbf-4ac6-bfd2-c1035776056a');
CREATE POLICY "GM: Read System Messages" ON public.gm_messages FOR SELECT USING (auth.uid() = 'a6630d04-ffbf-4ac6-bfd2-c1035776056a');

-- Profiles
CREATE POLICY "Profiles: Public Identification" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Profiles: Limited Update Ownership" ON public.profiles FOR UPDATE USING (auth.uid() = id) 
  WITH CHECK (auth.uid() = id AND (NOT (clout_points IS DISTINCT FROM clout_points)));

-- Security Logs (Silent Pulse)
CREATE POLICY "Security: Silent Pulse Insert" ON public.security_logs FOR INSERT WITH CHECK (true);

-- Events & Auto Events (Public Read, Authenticated Insert for Events)
CREATE POLICY "events_select_public" ON public.events FOR SELECT USING (true);
CREATE POLICY "Enable insert for everyone" ON public.events FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read approved auto events" ON public.auto_events FOR SELECT USING (is_approved = true);

-- Event Attendance & Favorites
CREATE POLICY "Only signed-in users can check in" ON public.event_attendance FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Anyone can read event_favorites" ON public.event_favorites FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert own favorites" ON public.event_favorites FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Authenticated users can delete own favorites" ON public.event_favorites FOR DELETE USING (auth.uid() = user_id);

-- Geoposts
CREATE POLICY "Allow public select access" ON public.geoposts FOR SELECT USING (true);
CREATE POLICY "Allow public insert access" ON public.geoposts FOR INSERT WITH CHECK (true);

-- Post Reactions
CREATE POLICY "Allow public reactions select" ON public.post_reactions FOR SELECT USING (true);
CREATE POLICY "Allow public reactions insert" ON public.post_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public reactions delete" ON public.post_reactions FOR DELETE USING (true);

-- Post Comments & Comment Reactions
CREATE POLICY "Allow public select on comments" ON public.post_comments FOR SELECT USING (true);
CREATE POLICY "Allow public insert on comments" ON public.post_comments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public select on comment rxns" ON public.comment_reactions FOR SELECT USING (true);
CREATE POLICY "Allow public insert on comment rxns" ON public.comment_reactions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public delete on comment rxns" ON public.comment_reactions FOR DELETE USING (true);

-- Ledger
CREATE POLICY "Users can view own ledger" ON public.clout_ledger FOR SELECT USING (auth.uid() = user_id);


-- ─── 8. AUTOMATED TRIGGERS (DB CONCURRENCY) ──────────────────────────────────

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

DROP TRIGGER IF EXISTS tr_sync_fav_count ON public.event_favorites;
CREATE TRIGGER tr_sync_fav_count
AFTER INSERT OR DELETE ON public.event_favorites
FOR EACH ROW EXECUTE FUNCTION sync_event_fav_count();


-- ─── 9. FINAL PERMISSIONS ────────────────────────────────────────────────────

GRANT SELECT, INSERT ON public.security_logs TO anon, authenticated;
GRANT SELECT, INSERT ON public.anon_device_interactions TO anon, authenticated;
GRANT SELECT, INSERT ON public.clout_ledger TO authenticated;
GRANT SELECT, INSERT ON public.post_comments TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.comment_reactions TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.post_reactions TO anon, authenticated;
GRANT SELECT, INSERT ON public.geoposts TO anon, authenticated;