/* ─────────────────────────────────────────────────────────────
   TAS → .ics — one task as an all-day calendar event.

   For the calendars a Google link can't reach: Apple Calendar and
   Outlook both open an .ics file. Pure, so it can be tested without
   a browser; calendar.html turns the string into a download.
   ───────────────────────────────────────────────────────────── */

// Text values escape backslash, comma, semicolon and newline (RFC 5545 §3.3.11)
const text = s => String(s ?? "")
  .replace(/\r/g, "")
  .replace(/\\/g, "\\\\")
  .replace(/\n/g, "\\n")
  .replace(/[,;]/g, "\\$&")

/** The .ics file for a task, or null if it has no usable date. */
export function icsFor(t, now = new Date()) {
  const day = String(t.end || t.date || t.start || "").slice(0, 10)
  const [y, m, d] = day.split("-").map(Number)
  if (!y || !m || !d) return null
  // DTEND is exclusive, so an all-day event ends on the following day.
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
  const ymd = s => s.replace(/-/g, "")
  // ponytail: long lines are not folded at 75 octets — Apple, Google and
  // Outlook all read them unfolded; fold here if a stricter reader turns up.
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TAS//Calendar//EN",
    "BEGIN:VEVENT",
    `UID:${t.id}@tas-33`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${ymd(day)}`,
    `DTEND;VALUE=DATE:${ymd(next)}`,
    `SUMMARY:${text(t.subject ? `${t.name} (${t.subject})` : t.name)}`,
    ...(t.note ? [`DESCRIPTION:${text(t.note)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n"
}
