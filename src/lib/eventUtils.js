// Shared event timing utilities

/**
 * Returns true if an event is currently happening (or just ended within the grace window).
 * - Auto events: 2 hours after start
 * - User/sample events: event_time_utc_end + 1 hour (or start + 3hr fallback)
 */
export function isEventHappeningNow(event) {
  if (!event?.event_time_utc) return false;
  const now = Date.now();
  const start = new Date(event.event_time_utc).getTime();
  if (now < start) return false;

  if (event._auto) {
    return now < start + 2 * 60 * 60 * 1000;
  }

  const end = event.event_time_utc_end
    ? new Date(event.event_time_utc_end).getTime()
    : start + 3 * 60 * 60 * 1000; // 3hr fallback when no end time
  return now < end + 60 * 60 * 1000; // +1hr grace
}

/**
 * Returns true if the event's check-in window is open:
 * started AND within (end + 1hr), same logic as isEventHappeningNow.
 */
export function isCheckInWindowOpen(event) {
  return isEventHappeningNow(event);
}
