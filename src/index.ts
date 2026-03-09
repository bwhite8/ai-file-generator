import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Agent, setGlobalDispatcher } from "undici";
import { claimNextJob } from "./db";
import { processJob } from "./worker";

// Node 22's built-in fetch (undici) has a default bodyTimeout of 5 minutes.
// OpenAI Responses API with shell tool can exceed that while the model
// executes code in the container. Extend to 10 minutes.
setGlobalDispatcher(
  new Agent({ bodyTimeout: 10 * 60 * 1000, headersTimeout: 10 * 60 * 1000 }),
);

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "300000", 10);
const PORT = parseInt(process.env.PORT || "3000", 10);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

let processing = false;

async function tick() {
  if (processing) return;
  processing = true;

  try {
    const job = await claimNextJob();
    if (job) {
      await processJob(job);
    }
  } catch (err) {
    console.error("[poll] error:", err);
  } finally {
    processing = false;
  }
}

// --- HTTP server for webhook trigger ---

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === "POST" && req.url === "/trigger") {
    const auth = req.headers["authorization"];
    if (!WEBHOOK_SECRET || auth !== `Bearer ${WEBHOOK_SECRET}`) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    // Consume body to prevent connection hang
    await readBody(req);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));

    // Fire processing after responding
    tick();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", processing }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`[worker] http server on port ${PORT}`);
  console.log(`[worker] fallback polling every ${POLL_INTERVAL}ms`);
});

// Fallback polling (now at 5min default instead of 10s)
setInterval(tick, POLL_INTERVAL);
tick();
