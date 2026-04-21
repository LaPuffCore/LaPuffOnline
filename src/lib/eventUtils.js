// Shared event timing utilities

/**
 * Returns true if the event is actively happening (started, before end+1hr grace).
 * Auto events: 2hr window. User/sample: event_time_utc_end + 1hr.
 */
export function isEventHappeningNow(event) {
  if (!event?.event_time_utc) return false;
  const now = Date.now();
  const start = new Date(event.event_time_utc).getTime();
  // 30-minute early grace for check-in / visibility
  if (now < start - 30 * 60 * 1000) return false;

  if (event._auto) {
    return now < start + 2 * 60 * 60 * 1000;
  }

  const end = event.event_time_utc_end
    ? new Date(event.event_time_utc_end).getTime()
    : start + 3 * 60 * 60 * 1000; // 3hr fallback
  return now < end + 60 * 60 * 1000; // +1hr grace
}

/**
 * Returns true only during the core event window (started → end).
 * Does NOT include the +1hr afters window.
 */
export function isEventLive(event) {
  if (!event?.event_time_utc) return false;
  const now = Date.now();
  const start = new Date(event.event_time_utc).getTime();
  if (now < start - 30 * 60 * 1000) return false;
  if (event._auto) return now < start + 2 * 60 * 60 * 1000;
  const end = event.event_time_utc_end
    ? new Date(event.event_time_utc_end).getTime()
    : start + 3 * 60 * 60 * 1000;
  return now < end;
}

/**
 * Returns true during the +1hr afters window after the event ends.
 */
export function isAftersWindow(event) {
  if (!event?.event_time_utc || event._auto) return false;
  const now = Date.now();
  const end = event.event_time_utc_end
    ? new Date(event.event_time_utc_end).getTime()
    : new Date(event.event_time_utc).getTime() + 3 * 60 * 60 * 1000;
  return now >= end && now < end + 60 * 60 * 1000;
}

/**
 * Returns true if the event's check-in window is open (same as isEventHappeningNow).
 */
export function isCheckInWindowOpen(event) {
  return isEventHappeningNow(event);
}
