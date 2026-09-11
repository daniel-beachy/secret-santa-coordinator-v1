import { findCircularOrder, normalizeName, validateExchangeInput } from "./engine.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (request.method === "POST" && url.pathname === "/api/exchanges") {
        return await createExchange(request, env.DB, url.origin);
      }
      if (request.method === "POST" && url.pathname === "/api/reveal") {
        return await revealRecipient(request, env.DB);
      }

      const exchangeMatch = url.pathname.match(/^\/api\/exchanges\/([a-zA-Z0-9_-]+)$/);
      if (exchangeMatch && request.method === "GET") {
        return await validateActiveExchange(env.DB, exchangeMatch[1]);
      }

      const adminMatch = url.pathname.match(/^\/api\/exchanges\/([a-zA-Z0-9_-]+)\/admin$/);
      if (adminMatch && request.method === "GET") {
        return await getAdminStatus(request, env.DB, adminMatch[1]);
      }

      const actionMatch = url.pathname.match(
        /^\/api\/exchanges\/([a-zA-Z0-9_-]+)\/(reset|restore)$/,
      );
      if (actionMatch && request.method === "POST") {
        return await updateExchangeStatus(request, env.DB, actionMatch[1], actionMatch[2]);
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.error("Request failed", error);
      return json({ error: "Something went wrong. Please try again." }, 500);
    }
  },
};

async function validateActiveExchange(db, exchangeId) {
  const exchange = await db
    .prepare("SELECT status FROM exchanges WHERE id = ?")
    .bind(exchangeId)
    .first();
  if (!exchange || exchange.status !== "active") {
    return json({ error: "That exchange code is not active. Ask your organizer for the current participant link." }, 404);
  }
  return json({ exchangeId, status: "active" });
}

async function createExchange(request, db, origin) {
  const body = await readJson(request);
  let input;
  try {
    input = validateExchangeInput(body.participants, body.exclusions);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  const order = findCircularOrder(input.names, input.exclusions, secureRandom);
  if (!order) {
    return json(
      {
        error:
          "No valid circular order exists with these exclusions. Remove one or more restrictions and try again.",
        code: "NO_VALID_ORDER",
      },
      422,
    );
  }

  const exchangeId = randomId(9);
  const adminToken = randomId(32);
  const now = new Date().toISOString();
  const pins = generateUniquePins(order.length);
  const statements = [
    db
      .prepare(
        "INSERT INTO exchanges (id, admin_token_hash, created_at, status) VALUES (?, ?, ?, 'active')",
      )
      .bind(exchangeId, await sha256(adminToken), now),
    db
      .prepare(
        "INSERT INTO exchange_events (exchange_id, event_type, occurred_at) VALUES (?, 'created', ?)",
      )
      .bind(exchangeId, now),
  ];

  const participantRecords = await Promise.all(order.map(async (fullName, index) => {
    const pin = pins[index];
    const salt = randomId(16);
    return {
      id: randomId(12),
      fullName,
      pin,
      salt,
      pinHash: await hashPin(pin, salt),
      recipientName: order[(index + 1) % order.length],
    };
  }));

  for (const participant of participantRecords) {
    statements.push(
      db
        .prepare(
          `INSERT INTO participants
            (id, exchange_id, full_name, name_key, pin_salt, pin_hash, recipient_name)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          participant.id,
          exchangeId,
          participant.fullName,
          normalizeName(participant.fullName),
          participant.salt,
          participant.pinHash,
          participant.recipientName,
        ),
    );
  }

  await db.batch(statements);
  const credentials = participantRecords.map(({ fullName, pin }) => ({ name: fullName, pin }));
  return json(
    {
      exchangeId,
      adminToken,
      createdAt: now,
      participantUrl: `${origin}/?exchange=${encodeURIComponent(exchangeId)}`,
      credentials: credentials.sort((a, b) => a.name.localeCompare(b.name)),
    },
    201,
  );
}

async function revealRecipient(request, db) {
  const body = await readJson(request);
  const exchangeId = String(body.exchangeId ?? "").trim();
  const nameKey = normalizeName(String(body.name ?? ""));
  const pin = String(body.pin ?? "");
  if (!exchangeId || !nameKey || !/^\d{4}$/.test(pin)) {
    return json({ error: "Enter your first name and four-digit PIN." }, 400);
  }

  const exchange = await db
    .prepare("SELECT status FROM exchanges WHERE id = ?")
    .bind(exchangeId)
    .first();
  if (!exchange || exchange.status !== "active") {
    return json({ error: "This exchange is not currently available." }, 404);
  }

  const participant = await db
    .prepare(
      `SELECT id, pin_salt, pin_hash, recipient_name, failed_attempts, locked_until
       FROM participants WHERE exchange_id = ? AND name_key = ?`,
    )
    .bind(exchangeId, nameKey)
    .first();

  const now = Date.now();
  if (participant?.locked_until && new Date(participant.locked_until).getTime() > now) {
    return json({ error: "Too many attempts. Please wait 15 minutes and try again." }, 429);
  }

  const valid = participant && timingSafeEqual(await hashPin(pin, participant.pin_salt), participant.pin_hash);
  if (!valid) {
    if (participant) {
      const attempts = Number(participant.failed_attempts) + 1;
      const lockUntil = attempts >= 5 ? new Date(now + 15 * 60 * 1000).toISOString() : null;
      await db
        .prepare(
          "UPDATE participants SET failed_attempts = ?, locked_until = ? WHERE id = ?",
        )
        .bind(attempts >= 5 ? 0 : attempts, lockUntil, participant.id)
        .run();
    }
    return json({ error: "That name and PIN combination was not recognized." }, 401);
  }

  await db
    .prepare("UPDATE participants SET failed_attempts = 0, locked_until = NULL WHERE id = ?")
    .bind(participant.id)
    .run();
  return json({ recipient: participant.recipient_name });
}

async function getAdminStatus(request, db, exchangeId) {
  const exchange = await authorizeAdmin(request, db, exchangeId);
  if (!exchange) return json({ error: "Not authorized." }, 401);

  const eventRows = await db
    .prepare(
      "SELECT event_type, occurred_at FROM exchange_events WHERE exchange_id = ? ORDER BY occurred_at DESC",
    )
    .bind(exchangeId)
    .all();
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM participants WHERE exchange_id = ?")
    .bind(exchangeId)
    .first();

  return json({
    exchangeId,
    status: exchange.status,
    createdAt: exchange.created_at,
    participantCount: Number(count.count),
    events: eventRows.results,
  });
}

async function updateExchangeStatus(request, db, exchangeId, action) {
  const exchange = await authorizeAdmin(request, db, exchangeId);
  if (!exchange) return json({ error: "Not authorized." }, 401);

  const targetStatus = action === "reset" ? "reset" : "active";
  if (exchange.status === targetStatus) {
    return json({ status: targetStatus });
  }

  const now = new Date().toISOString();
  const timestampColumn = action === "reset" ? "reset_at" : "restored_at";
  await db.batch([
    db
      .prepare(`UPDATE exchanges SET status = ?, ${timestampColumn} = ? WHERE id = ?`)
      .bind(targetStatus, now, exchangeId),
    db
      .prepare(
        "INSERT INTO exchange_events (exchange_id, event_type, occurred_at) VALUES (?, ?, ?)",
      )
      .bind(exchangeId, action === "reset" ? "reset" : "restored", now),
  ]);

  return json({ status: targetStatus, occurredAt: now });
}

async function authorizeAdmin(request, db, exchangeId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const exchange = await db
    .prepare("SELECT * FROM exchanges WHERE id = ?")
    .bind(exchangeId)
    .first();
  if (!exchange || !timingSafeEqual(await sha256(token), exchange.admin_token_hash)) return null;
  return exchange;
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Expected JSON request");
  }
  return request.json();
}

function generateUniquePins(count) {
  const pins = new Set();
  while (pins.size < count) {
    const bytes = new Uint16Array(1);
    crypto.getRandomValues(bytes);
    if (bytes[0] >= 60000) continue;
    pins.add(String(bytes[0] % 10000).padStart(4, "0"));
  }
  return [...pins];
}

function secureRandom() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}

function randomId(byteLength) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function hashPin(pin, salt) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(bits));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
