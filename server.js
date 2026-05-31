const express = require("express");
const { exec } = require("child_process");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

function runCoral(sql) {
  return new Promise((resolve, reject) => {
    const escaped = sql.replace(/"/g, '\\"');
    exec(
      `coral sql "${escaped}"`,
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) return reject(stderr || err.message);
        resolve(parseCoralOutput(stdout));
      },
    );
  });
}

function parseCoralOutput(raw) {
  const lines = raw.trim().split("\n").filter(Boolean);
  const dataLines = lines.filter(
    (l) => l.startsWith("|") && !l.match(/^\|[\s\-+|]+\|$/),
  );
  if (dataLines.length < 2) return [];
  const headers = dataLines[0]
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);
  return dataLines.slice(1).map((row) => {
    const cells = row
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? null;
    });
    return obj;
  });
}

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/issues", async (req, res) => {
  const { owner, repo, limit = 20 } = req.query;
  if (!owner || !repo)
    return res
      .status(400)
      .json({ ok: false, error: "owner and repo are required" });
  try {
    const data = await runCoral(
      `SELECT number, title, state, created_at FROM github.issues WHERE owner = '${owner}' AND repo = '${repo}' AND state = 'open' ORDER BY created_at DESC LIMIT ${limit}`,
    );
    res.json({ ok: true, data, source: "github.issues", owner, repo });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/pulls", async (req, res) => {
  const { owner, repo, limit = 20 } = req.query;
  if (!owner || !repo)
    return res
      .status(400)
      .json({ ok: false, error: "owner and repo are required" });
  try {
    const data = await runCoral(
      `SELECT number, title, state, created_at FROM github.pulls WHERE owner = '${owner}' AND repo = '${repo}' AND state = 'open' ORDER BY created_at DESC LIMIT ${limit}`,
    );
    res.json({ ok: true, data, source: "github.pulls", owner, repo });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/slack", async (req, res) => {
  const { limit = 20 } = req.query;
  try {
    const data = await runCoral(
      `SELECT id, name FROM slack.channels LIMIT ${limit}`,
    );
    res.json({ ok: true, data, source: "slack.channels" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/linear", async (req, res) => {
  const { limit = 20 } = req.query;
  try {
    const data = await runCoral(
      `SELECT id, identifier, title, priority_label FROM linear.issues LIMIT ${limit}`,
    );
    res.json({ ok: true, data, source: "linear.issues" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/query", async (req, res) => {
  const { sql } = req.body;
  if (!sql)
    return res.status(400).json({ ok: false, error: "No SQL provided" });
  try {
    const data = await runCoral(sql);
    res.json({ ok: true, data, sql, rowCount: data.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e), sql });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🪸 Sprint Health API → http://localhost:${PORT}`);
  console.log(`   GET  /api/issues?owner=vercel&repo=next.js`);
  console.log(`   GET  /api/pulls?owner=vercel&repo=next.js`);
  console.log(`   GET  /api/slack`);
  console.log(`   GET  /api/linear`);
  console.log(`   POST /api/query  { sql: "..." }\n`);
});
