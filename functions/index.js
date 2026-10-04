/**
 * TAS Calendar — Cloud Functions. Deliberately empty.
 *
 * notifyNewTask used to live here and pushed every new shared task to
 * every device. New tasks are announced on LINE by hand now, so the push
 * was the same news twice — and it fired for anything written to `tasks`,
 * which made it a way to message the whole class.
 *
 * The one notification that remains is the daily "due today / tomorrow"
 * reminder, a Netlify scheduled function (web/netlify/functions/reminder.js):
 * Cloud Functions need the Blaze plan and Netlify's come with the free one.
 *
 * If notifyNewTask was ever deployed, remove it:
 *   firebase functions:delete notifyNewTask
 */
