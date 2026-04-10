# Location-Based Points Attribution System

## Overview

This system ensures points are only awarded when users are **signed in AND verified as participants** (NYC location check passed in last 24 hours).

### Key Principle
- **Favoriting while inactive (not signed in or not participant) does NOT prevent future point attribution.**
- Points only trigger on the first favorite while in active state.
- Each user can contribute 5 points to each event exactly once.

---

## Data Flow

### 1. User Favorites While NOT Signed In or While Orbiter
- Favorite is added to `event_favorites` table
- Trigger increments `events.fav_count` (+1)
- **No points awarded**
- User can unfavorite later without consequences

### 2. User Becomes Participant (Signs In + Passes Location Check)
- User taps orbiter/participant button
- Clicks "Yes" to sync location
- Location ping returns `inNYC = true`
- **New RPC `award_points_for_active_favorites()` is called:**
  - Fetches all events user has favorited
  - For each favorite, checks if they've already contributed points
  - If NOT in `favorite_point_contributions` table:
    - Inserts row to mark contribution
    - Awards 5 points via `clout_ledger`

### 3. User Is Already Participant, Re-syncs
- Same flow, but RPC sees entries in `favorite_point_contributions`
- Those events are skipped (no duplicate points)
- New favorites since last sync (if any) get points

---

## Database Schema Required

### New Table: `favorite_point_contributions`
```sql
CREATE TABLE favorite_point_contributions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  event_id UUID NOT NULL REFERENCES events(id),
  contributed_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, event_id)  -- One contribution per user per event
);
```

### New RPC: `award_points_for_active_favorites(UUID)`
- Input: `p_user_id` (the authenticated user's ID)
- Logic:
  1. Get all events in `event_favorites` where `user_id = p_user_id`
  2. For each event, check `favorite_point_contributions` for existing entry
  3. If no entry exists:
     - Insert into `favorite_point_contributions` (marks contribution)
     - Insert 5 points into `clout_ledger`
  4. Return count of events that received points

---

## Code Changes Made

### 1. [SQL_SCHEMA_SETUP.sql](SQL_SCHEMA_SETUP.sql)
- Full SQL setup to run once in Supabase
- Creates all tables, triggers, and RPC function
- Includes RLS policies
- **Action: Copy and run in Supabase SQL Editor**

### 2. [src/lib/locationService.js](src/lib/locationService.js)
- New function: `awardPointsForActiveFavorites(session)`
- Calls the new RPC function
- Returns number of events that got points

### 3. [src/components/ParticipantDot.jsx](src/components/ParticipantDot.jsx)
- Updated imports to include `awardPointsForActiveFavorites` and `getValidSession`
- Updated `handleConfirm()` to:
  - After location ping returns `inNYC = true`
  - Get the auth session
  - Call `awardPointsForActiveFavorites()` if user is signed in
  - This happens before showing the success result

### 4. [src/lib/favorites.js](src/lib/favorites.js)
- Updated comments to reflect new points logic
- No code changes to the favorite toggle flow itself

---

## Testing Checklist

1. **Test as anonymous user:**
   - Favorite an event → universal count increases
   - Unfavorite → count decreases
   - Sign in (anonymous favorites convert to authenticated)

2. **Test as signed-in orbiter:**
   - Favorite event A while orbiter
   - Pass location check → become participant
   - Tap orbiter button → sync participant status
   - Check that 5 points awarded for event A
   - Favorite event B while still participant
   - Tap orbiter button again → should award points for event B only

3. **Test as signed-in participant:**
   - Already participant
   - Favorite event C → count increases
   - Tap orbiter button → sync again
   - Should award 5 points for event C immediately

4. **Test edge cases:**
   - Favorite, unfavorite, then become participant → NO points
   - Favorite while not signed in, sign in but don't become participant, then become participant → points awarded
   - Favorite, become participant, unfavorite, re-favorite → still only 5 points total (marked in contributions table)

---

## What You Need To Do

1. **Run the SQL setup:**
   - Open Supabase console
   - Go to SQL Editor
   - Open and run [SQL_SCHEMA_SETUP.sql](SQL_SCHEMA_SETUP.sql)
   - Verify no errors

2. **Test the flow:**
   - Use the checklist above
   - Check `favorite_point_contributions` table has correct entries
   - Check `clout_ledger` shows points being awarded at the right time

3. **Optional: Auto-close popup after result**
   - Currently result stays open until user clicks elsewhere
   - Can add `setTimeout(() => closePopup(), 2000)` in result state if desired

---

## Notes

- The 24-hour participant expiration is still enforced by `getNYCParticipantStatus()` in `locationService.js`
- Points are never deducted or removed, only awarded once per user per event
- The RPC is idempotent — calling it multiple times is safe
- All point awards are logged in clout_ledger for audit trail
