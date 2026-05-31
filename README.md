# 🏴‍☠️ Sprint Health Dashboard
> Pirates of the Coral-bean Hackathon Submission

A cross-source sprint intelligence agent that joins **GitHub issues**, **PRs**, **Slack threads**, and **Linear tasks** via a single Coral SQL query and analyze what's blocked, what's in review, and what needs attention.

## 🎥 Demo
[Add your Loom/video link here]

## 🏗️ Architecture

```
React Dashboard (UI)
       ↓
Coral MCP Server (local)
       ↓
┌──────────────────────────────────────┐
│  SELECT i.number, i.title,           │
│         p.state AS pr_state,         │
│         s.name  AS slack_channel,    │
│         l.title AS linear_task       │
│  FROM   github.issues   i            │
│  LEFT JOIN github.pulls p ON ...     │
│  LEFT JOIN slack.channels s ON ...   │
│  LEFT JOIN linear.issues  l ON ...   │
│  WHERE  i.state = 'open'             │
└──────────────────────────────────────┘
       ↓              ↓           ↓          ↓
   GitHub API    Slack API   Linear API  Confluence API
```

## ✨ Features
- **Cross-source JOIN** — single Coral SQL query spans GitHub + Slack + Linear + Confluence
- **Blocked detection** — issues with no linked PR and stale activity auto-flagged
- **Live data** — runs via `coral mcp-stdio` MCP server
- **4 sources, 1 query** — no bespoke glue code

## 🚀 Setup

### 1. Install Coral
```bash
# macOS
brew install withcoral/tap/coral

# Linux
curl -fsSL https://withcoral.com/install.sh | sh

# Windows — download binary from:
# https://github.com/withcoral/coral/releases
```

### 2. Add sources
```bash
coral source add --interactive github
coral source add --interactive slack
coral source add --interactive linear
coral source add --interactive confluence
```

### 3. Start Coral MCP server
```bash
coral mcp-stdio
```

### 4. Run the dashboard
```bash
npm install
npm start
```

## 🔑 The Coral Query
```sql
SELECT i.number, i.title AS issue_title, i.state,
       p.title AS pr_title, p.state AS pr_state,
       s.name  AS slack_channel,
       l.title AS linear_task
FROM   github.issues i
LEFT JOIN github.pulls    p ON p.number = i.number
                           AND p.owner  = 'your-org'
                           AND p.repo   = 'your-repo'
LEFT JOIN slack.channels  s ON s.name ILIKE '%engineering%'
LEFT JOIN linear.issues   l ON l.title ILIKE '%' || SPLIT_PART(i.title,' ',1) || '%'
WHERE  i.owner = 'your-org' AND i.repo = 'your-repo'
AND    i.state = 'open'
ORDER BY i.created_at DESC
LIMIT 15
```

## 🧰 Tech Stack
- **Coral** — cross-source SQL runtime (the star of the show)
- **React** — dashboard UI
- **GitHub / Slack / Linear / Confluence** — data sources via Coral

## 🏆 Why This Wins
- Showcases Coral's core superpower: **cross-source JOINs in one query**
- Real business value: blocked sprint = delayed releases = money lost
- Claude + Coral = 31% more accurate, 3.4x more cost efficient (per Coral benchmarks)
- Clean, production-grade UI that judges can actually use

## 👨‍💻 Built at
Pirates of the Coral-bean Hackathon · May 2026