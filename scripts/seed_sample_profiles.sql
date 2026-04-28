-- ============================================================
-- LaPuffOnline — Sample Data Seeding Script
-- Run this ONCE in the Supabase SQL Editor (with admin/service-role access).
--
-- What this does:
--   Inserts 34 sample user profiles, bypassing the auth.users FK constraint
--   so test profiles can exist without real auth accounts.
--   UUIDs match makeStableSampleUuid(idx, 'c000') in GeoPostView.jsx.
--
-- Sample EVENTS are synced automatically on app load (SYNC_SAMPLE_EVENTS_TO_SUPABASE=true
--   in sampleConfig.js) — no manual SQL needed for events.
-- Sample POSTS/COMMENTS are synced automatically on geo view load in SAMPLE_MODE.
-- ============================================================

SET session_replication_role = 'replica';

INSERT INTO profiles (id, username, clout_points, home_zip, bio) VALUES
  ('00000000-0000-4000-c000-000000000001', 'sample_user_1', 0, '10001', 'Sample participant user #1 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000002', 'sample_user_2', 0, '10001', 'Sample orbiter user #2 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000004', 'sample_user_4', 0, '10001', 'Sample participant user #4 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000005', 'sample_user_5', 0, '10001', 'Sample orbiter user #5 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000007', 'sample_user_7', 0, '10001', 'Sample participant user #7 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000008', 'sample_user_8', 0, '10001', 'Sample orbiter user #8 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000010', 'sample_user_10', 0, '10001', 'Sample participant user #10 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000011', 'sample_user_11', 0, '10001', 'Sample orbiter user #11 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000013', 'sample_user_13', 0, '10001', 'Sample participant user #13 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000014', 'sample_user_14', 0, '10001', 'Sample orbiter user #14 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000016', 'sample_user_16', 0, '10001', 'Sample participant user #16 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000017', 'sample_user_17', 0, '10001', 'Sample orbiter user #17 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000019', 'sample_user_19', 0, '10001', 'Sample participant user #19 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000020', 'sample_user_20', 0, '10001', 'Sample orbiter user #20 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000022', 'sample_user_22', 0, '10001', 'Sample participant user #22 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000023', 'sample_user_23', 0, '10001', 'Sample orbiter user #23 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000025', 'sample_user_25', 0, '10001', 'Sample participant user #25 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000026', 'sample_user_26', 0, '10001', 'Sample orbiter user #26 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000028', 'sample_user_28', 0, '10001', 'Sample participant user #28 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000029', 'sample_user_29', 0, '10001', 'Sample orbiter user #29 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000031', 'sample_user_31', 0, '10001', 'Sample participant user #31 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000032', 'sample_user_32', 0, '10001', 'Sample orbiter user #32 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000034', 'sample_user_34', 0, '10001', 'Sample participant user #34 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000035', 'sample_user_35', 0, '10001', 'Sample orbiter user #35 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000037', 'sample_user_37', 0, '10001', 'Sample participant user #37 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000038', 'sample_user_38', 0, '10001', 'Sample orbiter user #38 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000040', 'sample_user_40', 0, '10001', 'Sample participant user #40 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000041', 'sample_user_41', 0, '10001', 'Sample orbiter user #41 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000043', 'sample_user_43', 0, '10001', 'Sample participant user #43 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000044', 'sample_user_44', 0, '10001', 'Sample orbiter user #44 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000046', 'sample_user_46', 0, '10001', 'Sample participant user #46 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000047', 'sample_user_47', 0, '10001', 'Sample orbiter user #47 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000049', 'sample_user_49', 0, '10001', 'Sample participant user #49 for LaPuffOnline testing.'),
  ('00000000-0000-4000-c000-000000000050', 'sample_user_50', 0, '10001', 'Sample orbiter user #50 for LaPuffOnline testing.')
ON CONFLICT (id) DO UPDATE
  SET username = EXCLUDED.username,
      bio      = EXCLUDED.bio;

SET session_replication_role = DEFAULT;

-- Verify: should return 34 rows
SELECT id, username, bio FROM profiles
WHERE id::text LIKE '00000000-0000-4000-c000-%'
ORDER BY username;

