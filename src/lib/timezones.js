export const TIMEZONES = [
  { label: 'ET (NYC)', value: 'America/New_York', offset: -5 },
  { label: 'CT (Chicago)', value: 'America/Chicago', offset: -6 },
  { label: 'MT (Denver)', value: 'America/Denver', offset: -7 },
  { label: 'PT (LA)', value: 'America/Los_Angeles', offset: -8 },
  { label: 'AK (Anchorage)', value: 'America/Anchorage', offset: -9 },
  { label: 'HI (Honolulu)', value: 'Pacific/Honolulu', offset: -10 },
  { label: 'GMT (London)', value: 'Europe/London', offset: 0 },
  { label: 'CET (Paris)', value: 'Europe/Paris', offset: 1 },
  { label: 'JST (Tokyo)', value: 'Asia/Tokyo', offset: 9 },
  { label: 'AEST (Sydney)', value: 'Australia/Sydney', offset: 10 },
  { label: 'IST (Mumbai)', value: 'Asia/Kolkata', offset: 5.5 },
  { label: 'BRT (São Paulo)', value: 'America/Sao_Paulo', offset: -3 },
];

export function localToUTC(dateStr, timeStr, tzOffset) {
  // dateStr: "2026-04-15", timeStr: "14:00", tzOffset: -5
  const [h, m] = timeStr.split(':').map(Number);
  const totalMinutes = h * 60 + m - tzOffset * 60;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + totalMinutes);
  return d.toISOString();
}

export function utcToLocal(utcStr, tzOffset) {
  const d = new Date(utcStr);
  const offsetMs = tzOffset * 60 * 60 * 1000;
  const local = new Date(d.getTime() + offsetMs);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 || 12;
  const displayM = m.toString().padStart(2, '0');
  return `${displayH}:${displayM} ${ampm}`;
}

export function getUserTZOffset() {
  return -new Date().getTimezoneOffset() / 60;
}