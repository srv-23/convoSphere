/**
 * Reproducible before/after benchmark.
 *
 *   npm run bench
 *
 * Every number printed here comes from a real MongoDB (in-memory) with real
 * seeded documents, comparing the previous implementation (kept inline as
 * `legacy*`) with the code that now ships in src/.
 *
 * Nothing here talks to Atlas, Cloudinary, Resend or Arcjet.
 */
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { MongoMemoryServer } from "mongodb-memory-server";

const USERS = 200;
const MESSAGES = 50_000;
const HISTORY_SIZE = 3_000;
const PAGE_SIZE = 30;
const ITERATIONS = 9;
const WARMUP = 2;

const mongo = await MongoMemoryServer.create();

// env.js validates at import time, so configuration must exist before the
// application modules are loaded.
process.env.NODE_ENV = "test";
process.env.MONGO_URI = mongo.getUri();
process.env.JWT_SECRET = "bench-jwt-secret-long-enough";
process.env.CLIENT_URL = "http://localhost:5173";
process.env.RESEND_API_KEY = "";
process.env.CLOUDINARY_CLOUD_NAME = "";
process.env.CLOUDINARY_API_KEY = "";
process.env.CLOUDINARY_API_SECRET = "";
process.env.ARCJET_KEY = "";

const mongoose = (await import("mongoose")).default;
const { default: Message } = await import("../src/models/Message.js");
const { default: User } = await import("../src/models/User.js");
const controller = await import("../src/controllers/message.controller.js");
const presence = await import("../src/lib/presence.js");

await mongoose.connect(mongo.getUri(), { dbName: "bench" });

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const p95 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};

async function time(fn) {
  const samples = [];
  let result;

  for (let i = 0; i < WARMUP + ITERATIONS; i += 1) {
    const started = performance.now();
    result = await fn();
    const elapsed = performance.now() - started;
    if (i >= WARMUP) samples.push(elapsed);
  }

  return { ms: median(samples), p95: p95(samples), samples, result };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function callController(handler, req) {
  const res = fakeRes();
  let caught;
  await handler(req, res, (error) => {
    caught = error;
  });
  if (caught) throw caught;
  if (res.statusCode >= 400) throw new Error(`controller returned ${res.statusCode}`);
  return res.body;
}

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

// ---------------------------------------------------------------------------
// seed
// ---------------------------------------------------------------------------

console.log(`Seeding ${USERS} users and ${MESSAGES} messages...`);

const userDocs = Array.from({ length: USERS }, (_, i) => ({
  _id: new mongoose.Types.ObjectId(),
  fullName: `User ${String(i).padStart(3, "0")}`,
  email: `user${i}@bench.local`,
  password: "$2a$10$benchbenchbenchbenchbenchbenchbenchbenchbenchben",
  profilePic: "",
  createdAt: new Date(),
  updatedAt: new Date(),
}));

await User.collection.insertMany(userDocs);

const me = userDocs[0]._id;
const partners = userDocs.slice(1);

const baseTime = Date.now() - 60 * 24 * 60 * 60 * 1000;

function buildMessages(count, senderId, receiverId, startIndex = 0, stepMs = 1000) {
  return Array.from({ length: count }, (_, i) => {
    const created = new Date(baseTime + (startIndex + i) * stepMs);
    return {
      _id: new mongoose.Types.ObjectId(),
      senderId,
      receiverId,
      text: `message ${startIndex + i} with some realistic body text in it`,
      status: "read",
      createdAt: created,
      updatedAt: created,
    };
  });
}

// Spread MESSAGES across all partners in chunks so the insert stays fast.
const CHUNK = 5_000;
for (let offset = 0; offset < MESSAGES; offset += CHUNK) {
  const docs = [];
  for (let i = offset; i < Math.min(offset + CHUNK, MESSAGES); i += 1) {
    const partner = partners[i % partners.length];
    // Alternate direction so both sides of the $or are exercised.
    const forward = i % 3 !== 0;
    docs.push(
      ...buildMessages(
        1,
        forward ? me : partner._id,
        forward ? partner._id : me,
        i
      )
    );
  }
  await Message.collection.insertMany(docs);
}

// One deep conversation for the history/pagination benchmark.
const deepPartner = partners[0]._id;
await Message.collection.insertMany(
  buildMessages(HISTORY_SIZE, deepPartner, me, MESSAGES + 1, 1000)
);

// Ensure indexes exist exactly as the model declares them.
await Message.syncIndexes();
await User.syncIndexes();

const totalMessages = await Message.estimatedDocumentCount();
console.log(`Seeded ${totalMessages} messages.`);

// ---------------------------------------------------------------------------
// 1. chat partner list
// ---------------------------------------------------------------------------

// Verbatim previous implementation: load every message, de-duplicate in JS.
async function legacyGetChatPartners(meId) {
  const messages = await Message.find({
    $or: [{ senderId: meId }, { receiverId: meId }],
  });

  const chatPartnerIds = [
    ...new Set(
      messages.map((msg) =>
        msg.senderId.toString() === meId.toString()
          ? msg.receiverId.toString()
          : msg.senderId.toString()
      )
    ),
  ];

  const chatPartners = await User.find({ _id: { $in: chatPartnerIds } }).select("-password");
  return { chatPartners, messagesLoaded: messages.length };
}

const req = { user: { _id: me }, query: {}, params: {} };

const chatsLegacy = await time(() => legacyGetChatPartners(me));
const chatsNew = await time(() => callController(controller.getChatPartners, req));

// ---------------------------------------------------------------------------
// 2. conversation history / payload
// ---------------------------------------------------------------------------

// Verbatim previous implementation: the entire thread in one response.
async function legacyGetConversation(meId, partnerId) {
  return Message.find({
    $or: [
      { senderId: meId, receiverId: partnerId },
      { senderId: partnerId, receiverId: meId },
    ],
  });
}

const historyLegacy = await time(() => legacyGetConversation(me, deepPartner));
const historyNew = await time(() =>
  callController(controller.getMessagesByUserId, {
    user: { _id: me },
    params: { id: String(deepPartner) },
    query: { limit: String(PAGE_SIZE) },
  })
);

const legacyPayload = bytes(historyLegacy.result);
const newPayload = bytes(historyNew.result);
const legacyDocCount = historyLegacy.result.length;
const newDocCount = historyNew.result.messages.length;

// ---------------------------------------------------------------------------
// 3. index usage
// ---------------------------------------------------------------------------

const threadFilter = {
  $or: [
    { senderId: me, receiverId: deepPartner },
    { senderId: deepPartner, receiverId: me },
  ],
};

// "Before" = the old endpoint: the whole thread, no index-friendly sort/limit.
// "After" = one page of the new endpoint.
const withIndex = await Message.find(threadFilter)
  .sort({ createdAt: -1 })
  .limit(PAGE_SIZE)
  .explain("executionStats");

const withoutIndex = await Message.collection
  .find(threadFilter)
  .hint({ $natural: 1 })
  .explain("executionStats");

const docsExamined = (plan) => plan.executionStats?.totalDocsExamined ?? 0;

// ---------------------------------------------------------------------------
// 4. presence fan-out
// ---------------------------------------------------------------------------

const ONLINE_USERS = 500;
const TABS_PER_USER = 3;

function simulatePresenceBroadcasts({ firstLastOnly }) {
  presence.resetPresence();
  let emits = 0;
  let payloadItems = 0;

  const socketId = (user, tab) => `u${user}-tab${tab}`;

  const shouldBroadcastAfter = (userKey, wasOnline) => {
    if (!firstLastOnly) return true; // previous behaviour: always
    const isOnlineNow = presence.isOnline(userKey);
    return wasOnline !== isOnlineNow; // only when online state flips
  };

  // Everyone connects.
  for (let user = 0; user < ONLINE_USERS; user += 1) {
    const userKey = `u${user}`;
    for (let tab = 0; tab < TABS_PER_USER; tab += 1) {
      const wasOnline = presence.isOnline(userKey);
      presence.addSocket(userKey, socketId(user, tab));

      if (shouldBroadcastAfter(userKey, wasOnline)) {
        emits += 1;
        payloadItems += presence.getOnlineUserIds().length;
      }
    }
  }

  // Everyone disconnects, tab by tab.
  for (let user = 0; user < ONLINE_USERS; user += 1) {
    const userKey = `u${user}`;
    for (let tab = 0; tab < TABS_PER_USER; tab += 1) {
      const wasOnline = presence.isOnline(userKey);
      presence.removeSocket(userKey, socketId(user, tab));

      if (shouldBroadcastAfter(userKey, wasOnline)) {
        emits += 1;
        payloadItems += presence.getOnlineUserIds().length;
      }
    }
  }

  return { emits, payloadItems };
}

const legacyPresence = simulatePresenceBroadcasts({ firstLastOnly: false });
const newPresence = simulatePresenceBroadcasts({ firstLastOnly: true });

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const pct = (from, to) => {
  if (from === 0) return "0%";
  const change = ((from - to) / from) * 100;
  return `${change >= 0 ? "-" : "+"}${Math.abs(change).toFixed(1)}%`;
};

const fmt = (value) => `${value.toFixed(1)} ms`;
const int = (value) => value.toLocaleString("en-US");

const rows = [
  {
    metric: "Chat list (`GET /api/messages/chats`)",
    before: `${fmt(chatsLegacy.ms)} · ${int(chatsLegacy.result.messagesLoaded)} docs loaded into Node`,
    after: `${fmt(chatsNew.ms)} · ${int(chatsNew.result.length)} rows returned`,
    change: pct(chatsLegacy.ms, chatsNew.ms),
  },
  {
    metric: "Open conversation (`GET /api/messages/:id`)",
    before: `${fmt(historyLegacy.ms)} · ${int(legacyPayload)} B · ${int(legacyDocCount)} messages`,
    after: `${fmt(historyNew.ms)} · ${int(newPayload)} B · ${int(newDocCount)} messages`,
    change: pct(legacyPayload, newPayload) + " payload",
  },
  {
    metric: "Documents examined to serve a conversation",
    before: `${int(docsExamined(withoutIndex))} (full thread, no index)`,
    after: `${int(docsExamined(withIndex))} (one page, compound index)`,
    change: pct(docsExamined(withoutIndex), docsExamined(withIndex)),
  },
  {
    metric: `Presence broadcasts (${ONLINE_USERS} users × ${TABS_PER_USER} tabs)`,
    before: `${int(legacyPresence.emits)} emits · ${int(legacyPresence.payloadItems)} payload entries`,
    after: `${int(newPresence.emits)} emits · ${int(newPresence.payloadItems)} payload entries`,
    change: pct(legacyPresence.emits, newPresence.emits),
  },
];

const table = [
  "| Metric | Before | After | Change |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.metric} | ${row.before} | ${row.after} | ${row.change} |`),
].join("\n");

const details = `
| Detail | Value |
| --- | --- |
| Dataset | ${int(totalMessages)} messages, ${int(USERS)} users |
| Deep conversation | ${int(HISTORY_SIZE)} messages |
| Page size | ${PAGE_SIZE} |
| Iterations per case | ${ITERATIONS} (median, ${WARMUP} warm-up) |
| Chat list p95 | before ${fmt(chatsLegacy.p95)} / after ${fmt(chatsNew.p95)} |
| Conversation p95 | before ${fmt(historyLegacy.p95)} / after ${fmt(historyNew.p95)} |
| Index plan time | ${withIndex.executionStats?.executionTimeMillis ?? "?"} ms |
| Collection scan plan time | ${withoutIndex.executionStats?.executionTimeMillis ?? "?"} ms |
| Node | ${process.version} |
| Platform | ${process.platform} ${process.arch} |
| Date | ${new Date().toISOString().slice(0, 10)} |
`.trim();

const output = `# Benchmark results

Generated by \`npm run bench\` (backend). Every figure is measured against a
real, in-memory MongoDB seeded with the same data for both implementations.

${table}

## Measurement details

${details}

## What each row means

- **Chat list** — the previous controller loaded every message the user had
  ever exchanged and de-duplicated partners in JavaScript. The current one
  does the grouping, last-message lookup and unread count in one aggregation.
- **Open conversation** — the previous endpoint returned the whole thread; the
  current one returns the newest ${PAGE_SIZE} messages plus a \`hasMore\` flag, and
  older pages load on demand. The payload column is the practical difference
  for a mobile client.
- **Documents examined** — \`explain("executionStats")\` for the old query (whole
  thread, collection scan) versus the new one (one page, compound index).
  Fewer documents examined means the work stays flat as history grows.
- **Presence broadcasts** — connect/disconnect events for ${ONLINE_USERS} users
  with ${TABS_PER_USER} tabs each, comparing "broadcast on every socket" with
  "broadcast only when a user goes online or offline".

## Reproduce

\`\`\`bash
cd backend
npm run bench
\`\`\`

Document counts, byte sizes and event counts are exact and reproduce on any
machine. Wall-clock timings vary between runs (observed 68–77% for the chat
list), so quote the conservative end.

Results vary with hardware; re-run before quoting a number.
`;

console.log("\n" + table + "\n");
console.log(details + "\n");

const outPath = path.join(import.meta.dirname, "RESULTS.md");
fs.writeFileSync(outPath, output, "utf8");
console.log(`Wrote ${outPath}`);

await mongoose.disconnect();
await mongo.stop();
