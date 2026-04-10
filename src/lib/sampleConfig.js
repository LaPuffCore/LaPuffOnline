// ============================================================
// SAMPLE_MODE — set to false when done developing
// ============================================================
export const SAMPLE_MODE = true;

// When true, sample events from sampleEvents.js are synced into Supabase
// with zip_code='SAMPLE' so universal favorite counts can be tested.
export const SYNC_SAMPLE_EVENTS_TO_SUPABASE = true;

// When SAMPLE_MODE is false and this is true, rows with zip_code='SAMPLE'
// are deleted from Supabase.
export const CLEAR_SUPABASE_SAMPLES_ON_DISABLE = true;