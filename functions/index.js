/**
 * TAS Calendar — cloud push sender.
 *
 * When a moderator posts a shared task, fan a Web Push notification out to
 * every device that turned notifications on in the calendar (their FCM
 * tokens live in the `fcmTokens` collection, written by calendar.html).
 * Tokens that FCM reports as dead are pruned so the list stays clean.
 */

const {setGlobalOptions} = require("firebase-functions");
const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
setGlobalOptions({maxInstances: 10});

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function shortDate(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]}`;
}

exports.notifyNewTask = onDocumentCreated("tasks/{taskId}", async (event) => {
  const t = event.data && event.data.data();
  if (!t || !t.name) return;

  const snap = await admin.firestore().collection("fcmTokens").get();
  if (snap.empty) return;
  const tokens = snap.docs.map((d) => d.id);

  const title = t.type === "marker" ?
    `📍 New event: ${t.name}` :
    `🆕 New task: ${t.name}`;
  const body = [t.subject, t.end ? `due ${shortDate(t.end)}` : ""]
      .filter(Boolean).join(" · ");

  const dead = [];
  // sendEachForMulticast takes at most 500 tokens per call
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    const res = await admin.messaging().sendEachForMulticast({
      tokens: chunk,
      webpush: {
        notification: {
          title,
          body,
          icon: "TASLogo.png",
          tag: "tas-new-" + event.params.taskId,
        },
        fcmOptions: {link: "/calendar.html"},
      },
    });
    res.responses.forEach((r, j) => {
      if (r.success) return;
      const code = (r.error && r.error.code) || "";
      if (code.includes("registration-token-not-registered") ||
          code.includes("invalid-argument")) dead.push(chunk[j]);
    });
    logger.info(`Task ${event.params.taskId}: pushed to ${chunk.length} ` +
      `tokens, ${res.failureCount} failed`);
  }

  await Promise.all(dead.map((tk) =>
    admin.firestore().doc("fcmTokens/" + tk).delete()));
  if (dead.length) logger.info(`Pruned ${dead.length} dead tokens`);
});

/* The daily "due today / tomorrow" reminder used to live here. It moved
 * to a Netlify scheduled function (web/netlify/functions/reminder.js):
 * Cloud Functions need the Blaze plan, Netlify scheduled functions come
 * with the free one, and this project already ships a Netlify function.
 *
 * Deliberately not left here as a spare. If it were, a later
 * `firebase deploy` would quietly stand a second sender up beside the
 * Netlify one and everyone would get the reminder twice. */
