import { useState, useEffect, useCallback } from "react";

const API = "http://localhost:3001/api";

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (isNaN(diff)) return null;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function getStatus(issue, pulls) {
  const hasPR = pulls.some((p) => String(p.number) === String(issue.number));
  const createdAt = issue.created_at || issue.created_at;
  const ageHours = createdAt ? (Date.now() - new Date(createdAt)) / 3600000 : 0;
  if (!hasPR && ageHours > 12) return "blocked";
  if (hasPR) return "in-review";
  return "in-progress";
}

const S_COLOR = { blocked: "#ef4444", "in-review": "#f59e0b", "in-progress": "#3b82f6" };
const S_LABEL = { blocked: "blocked", "in-review": "in review", "in-progress": "in progress" };

function buildSQL(owner, repo) {
  return `SELECT i.number, i.title AS issue_title, i.state,
       p.title AS pr_title, p.state AS pr_state,
       s.name  AS slack_channel,
       l.title AS linear_task
FROM   github.issues i
LEFT JOIN github.pulls    p ON p.number = i.number
                           AND p.owner  = '${owner}'
                           AND p.repo   = '${repo}'
LEFT JOIN slack.channels  s ON s.name IS NOT NULL
LEFT JOIN linear.issues   l ON l.title IS NOT NULL
WHERE  i.owner = '${owner}' AND i.repo = '${repo}'
AND    i.state = 'open'
ORDER BY i.created_at DESC LIMIT 15`;
}

function Pill({ bg, color, border, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, padding: "2px 8px", borderRadius: 99,
      fontFamily: "'DM Mono',monospace",
      background: bg, color, border: `1px solid ${border}`
    }}>
      {children}
    </span>
  );
}

export default function App() {
  const [owner, setOwner] = useState("withcoral");
  const [repo, setRepo] = useState("coral");
  const [ownerInput, setOwnerInput] = useState("withcoral");
  const [repoInput, setRepoInput] = useState("coral");

  const [issues, setIssues] = useState([]);
  const [pulls, setPulls] = useState([]);
  const [slack, setSlack] = useState([]);
  const [linear, setLinear] = useState([]);
  const [sourceMeta, setSourceMeta] = useState({});

  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [activeTab, setActiveTab] = useState("all");
  const [sqlVisible, setSqlVisible] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  const fetchAll = useCallback(async (o, r) => {
    setLoading(true);
    setErrors({});
    setQueryResult(null);
    const newErrors = {};
    const meta = {};

    const results = await Promise.allSettled([
      fetch(`${API}/issues?owner=${o}&repo=${r}&limit=20`).then(x => x.json()),
      fetch(`${API}/pulls?owner=${o}&repo=${r}&limit=20`).then(x => x.json()),
      fetch(`${API}/slack?limit=20`).then(x => x.json()),
      fetch(`${API}/linear?limit=20`).then(x => x.json()),
    ]);

    const [iss, prs, slk, lin] = results;

    if (iss.status === "fulfilled" && iss.value.ok) {
      setIssues(iss.value.data || []);
      meta.github_issues = iss.value.data?.length ?? 0;
    } else {
      setIssues([]);
      newErrors.issues = iss.status === "rejected" ? "Backend unreachable" : iss.value?.error;
    }

    if (prs.status === "fulfilled" && prs.value.ok) {
      setPulls(prs.value.data || []);
      meta.github_pulls = prs.value.data?.length ?? 0;
    } else {
      setPulls([]);
      newErrors.pulls = prs.status === "rejected" ? "Backend unreachable" : prs.value?.error;
    }

    if (slk.status === "fulfilled" && slk.value.ok) {
      setSlack(slk.value.data || []);
      meta.slack_channels = slk.value.data?.length ?? 0;
    } else {
      setSlack([]);
      newErrors.slack = slk.status === "rejected" ? "Backend unreachable" : slk.value?.error;
    }

    if (lin.status === "fulfilled" && lin.value.ok) {
      setLinear(lin.value.data || []);
      meta.linear_issues = lin.value.data?.length ?? 0;
    } else {
      setLinear([]);
      newErrors.linear = lin.status === "rejected" ? "Backend unreachable" : lin.value?.error;
    }

    setSourceMeta(meta);
    setErrors(newErrors);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(owner, repo); }, [owner, repo, fetchAll]);

  const handleApply = () => {
    const o = ownerInput.trim();
    const r = repoInput.trim();
    if (!o || !r) return;
    setOwner(o); setRepo(r); setShowConfig(false);
  };

  const joined = issues.map((issue, idx) => {
    const pr = pulls.find((p) => String(p.number) === String(issue.number)) || null;
    const slackChannel = slack.length > 0 ? slack[idx % slack.length] : null;
    const linearIssue = linear.length > 0 ? linear[idx % linear.length] : null;
    return { ...issue, status: getStatus(issue, pulls), pr, slackChannel, linearIssue };
  });

  const blocked = joined.filter(i => i.status === "blocked");
  const inReview = joined.filter(i => i.status === "in-review");
  const inProgress = joined.filter(i => i.status === "in-progress");
  const filtered =
    activeTab === "blocked" ? blocked :
    activeTab === "review" ? inReview :
    activeTab === "progress" ? inProgress : joined;

  const runCrossJoin = async () => {
    setQuerying(true);
    setQueryResult(null);
    try {
      const res = await fetch(`${API}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: buildSQL(owner, repo) }),
      });
      const json = await res.json();
      setQueryResult(json);
    } catch (e) {
      setQueryResult({ ok: false, error: e.message });
    }
    setQuerying(false);
  };

  const connectedSources = Object.keys(sourceMeta);
  const hasErrors = Object.keys(errors).length > 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", color: "#e2e8f0", fontFamily: "'DM Mono','Fira Code',monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#0a0a0f}::-webkit-scrollbar-thumb{background:#2d2d3a;border-radius:2px}
        .tab{background:none;border:none;color:#64748b;font-family:'DM Mono',monospace;font-size:11px;padding:6px 14px;cursor:pointer;border-radius:4px;transition:all .15s}
        .tab.active{background:#1e1e2e;color:#e2e8f0}.tab:hover{color:#e2e8f0}
        .issue-row{display:grid;grid-template-columns:64px 1fr auto;gap:12px;align-items:start;padding:12px 16px;border-bottom:1px solid #1e1e2e;transition:background .1s}
        .issue-row:hover{background:#0d0d14}.issue-row:last-child{border-bottom:none}
        .btn{background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;font-family:'DM Mono',monospace;font-size:12px;padding:9px 18px;border-radius:6px;cursor:pointer;transition:opacity .2s}
        .btn:hover{opacity:.85}.btn:disabled{opacity:.4;cursor:not-allowed}
        .btn-sm{background:none;border:1px solid #2d2d3a;color:#94a3b8;font-family:'DM Mono',monospace;font-size:11px;padding:6px 14px;border-radius:6px;cursor:pointer;transition:all .15s}
        .btn-sm:hover{border-color:#6366f1;color:#e2e8f0}
        .input{background:#0d0d14;border:1px solid #2d2d3a;border-radius:6px;color:#e2e8f0;font-family:'DM Mono',monospace;font-size:12px;padding:8px 12px;outline:none;transition:border .15s;width:100%}
        .input:focus{border-color:#6366f1}
        .sql-block{background:#0d0d14;border:1px solid #1e1e2e;border-radius:6px;padding:16px;font-size:11px;line-height:1.8;color:#94a3b8;white-space:pre-wrap;font-family:'DM Mono',monospace;overflow-x:auto;margin-top:14px}
        .kw{color:#818cf8}.str{color:#34d399}.cm{color:#334155}
        .card{background:#111118;border:1px solid #1e1e2e;border-radius:8px;padding:16px 20px}
        .sdot{width:6px;height:6px;border-radius:50%;display:inline-block;margin-right:5px}
        .sdot-ok{background:#22c55e;box-shadow:0 0 6px #22c55e}
        .sdot-err{background:#ef4444;box-shadow:0 0 6px #ef4444}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        .fade-in{animation:fadeIn .3s ease forwards}
        .spinner{width:14px;height:14px;border:2px solid #2d2d3a;border-top-color:#6366f1;border-radius:50%;animation:spin .7s linear infinite;display:inline-block;vertical-align:-3px;margin-right:6px}
      `}</style>

      <div style={{ borderBottom: "1px solid #1e1e2e", padding: "14px 32px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>
            sprint<span style={{ color: "#6366f1" }}>.</span>health
          </div>
          <div style={{ fontSize: 10, color: "#475569" }}>
            <span style={{ color: "#818cf8" }}>coral sql</span> · {owner}/{repo}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {connectedSources.length > 0 && connectedSources.map(s => (
            <span key={s} style={{ fontSize: 10, color: "#64748b" }}>
              <span className="sdot sdot-ok"></span>{s.replace("_", ".")}
            </span>
          ))}
          {Object.keys(errors).map(s => (
            <span key={s} style={{ fontSize: 10, color: "#64748b" }}>
              <span className="sdot sdot-err"></span>{s}
            </span>
          ))}
          <button className="btn-sm" onClick={() => setShowConfig(v => !v)}>⚙ configure</button>
          <button className="btn-sm" onClick={() => fetchAll(owner, repo)} disabled={loading}>
            {loading ? <><span className="spinner"></span>loading</> : "↺ refresh"}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 32px" }}>

        {showConfig && (
          <div className="card fade-in" style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, color: "#818cf8", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.08em" }}>configure repository</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "end" }}>
              <div>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>github owner</div>
                <input className="input" placeholder="e.g. vercel" value={ownerInput}
                  onChange={e => setOwnerInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleApply()} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>repository</div>
                <input className="input" placeholder="e.g. next.js" value={repoInput}
                  onChange={e => setRepoInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleApply()} />
              </div>
              <button className="btn" onClick={handleApply} style={{ height: 36 }}>apply →</button>
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[["withcoral","coral"],["vercel","next.js"],["facebook","react"],["microsoft","vscode"]].map(([o, r]) => (
                <button key={o+r} className="btn-sm" style={{ fontSize: 10, padding: "4px 10px" }}
                  onClick={() => { setOwnerInput(o); setRepoInput(r); setOwner(o); setRepo(r); setShowConfig(false); }}>
                  {o}/{r}
                </button>
              ))}
            </div>
          </div>
        )}

        {hasErrors && (
          <div style={{ background: "#1a0a0a", border: "1px solid #ef444433", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 11, color: "#ef4444" }}>
            {Object.entries(errors).map(([src, msg]) => (
              <div key={src}>⚠ {src}: {msg}</div>
            ))}
            {errors.issues === "Backend unreachable" && (
              <div style={{ marginTop: 6, color: "#94a3b8" }}>Run: <code style={{ background: "#0d0d14", padding: "1px 6px", borderRadius: 4 }}>node server.js</code></div>
            )}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 24 }}>
          {issues.length > 0 && (
            <div className="card fade-in">
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>open issues</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: "#e2e8f0", fontFamily: "'Syne',sans-serif" }}>{joined.length}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>{owner}/{repo}</div>
            </div>
          )}
          {pulls.length > 0 && (
            <div className="card fade-in">
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>PRs in review</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: "#f59e0b", fontFamily: "'Syne',sans-serif" }}>{inReview.length}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>github.pulls</div>
            </div>
          )}
          {issues.length > 0 && blocked.length > 0 && (
            <div className="card fade-in">
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>blocked</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: "#ef4444", fontFamily: "'Syne',sans-serif" }}>{blocked.length}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>no PR · stale &gt;12h</div>
            </div>
          )}
          {slack.length > 0 && (
            <div className="card fade-in">
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>slack channels</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: "#34d399", fontFamily: "'Syne',sans-serif" }}>{slack.length}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>slack.channels</div>
            </div>
          )}
          {linear.length > 0 && (
            <div className="card fade-in">
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>linear tasks</div>
              <div style={{ fontSize: 28, fontWeight: 500, color: "#818cf8", fontFamily: "'Syne',sans-serif" }}>{linear.length}</div>
              <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>linear.issues</div>
            </div>
          )}
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 11, color: "#818cf8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>coral cross-source join</div>
              <div style={{ fontSize: 11, color: "#475569" }}>
                {connectedSources.map(s => s.replace("_",".")).join(" + ")} · 1 query · live
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-sm" onClick={() => setSqlVisible(v => !v)}>{sqlVisible ? "hide sql" : "show sql"}</button>
              <button className="btn" onClick={runCrossJoin} disabled={querying}>
                {querying ? <><span className="spinner"></span>running…</> : "▶ run live query"}
              </button>
            </div>
          </div>
          {sqlVisible && (
            <div className="sql-block fade-in">
              {buildSQL(owner, repo).split("\n").map((line, i) => {
                const keywords = ["SELECT","FROM","LEFT JOIN","WHERE","AND","ON","ORDER BY","DESC","LIMIT","AS","IS NOT NULL"];
                const parts = line.split(/('(?:[^']*)')/g);
                return (
                  <span key={i}>
                    {parts.map((p, j) => {
                      if (p.startsWith("'")) return <span key={j} className="str">{p}</span>;
                      const re = new RegExp(`\\b(${keywords.join("|")})\\b`);
                      return p.split(re).map((chunk, k) =>
                        keywords.includes(chunk)
                          ? <span key={k} className="kw">{chunk}</span>
                          : chunk
                      );
                    })}
                    {"\n"}
                  </span>
                );
              })}
              <span className="cm">-- {connectedSources.length} live sources · local-first · credentials never leave your machine</span>
            </div>
          )}
          {queryResult && (
            <div style={{
              marginTop: 12, borderRadius: 6, padding: "10px 14px", fontSize: 11,
              background: queryResult.ok ? "#0a1a0a" : "#1a0a0a",
              border: `1px solid ${queryResult.ok ? "#34d39933" : "#ef444433"}`,
              color: queryResult.ok ? "#34d399" : "#ef4444"
            }}>
              {queryResult.ok
                ? `✓ cross-source JOIN returned ${queryResult.rowCount} rows from ${connectedSources.length} sources`
                : `✗ ${queryResult.error}`}
            </div>
          )}
        </div>

        {joined.length > 0 && (
          <div style={{ background: "#111118", border: "1px solid #1e1e2e", borderRadius: 8, marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #1e1e2e" }}>
              <div style={{ display: "flex", gap: 4 }}>
                <button className={`tab ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")}>
                  all ({joined.length})
                </button>
                {blocked.length > 0 && (
                  <button className={`tab ${activeTab === "blocked" ? "active" : ""}`} onClick={() => setActiveTab("blocked")}>
                    blocked ({blocked.length})
                  </button>
                )}
                {inReview.length > 0 && (
                  <button className={`tab ${activeTab === "review" ? "active" : ""}`} onClick={() => setActiveTab("review")}>
                    in review ({inReview.length})
                  </button>
                )}
                {inProgress.length > 0 && (
                  <button className={`tab ${activeTab === "progress" ? "active" : ""}`} onClick={() => setActiveTab("progress")}>
                    in progress ({inProgress.length})
                  </button>
                )}
              </div>
              {lastRefresh && (
                <div style={{ fontSize: 10, color: "#475569" }}>
                  updated {timeAgo(lastRefresh.toISOString())}
                </div>
              )}
            </div>

            <div>
              {loading ? (
                <div style={{ padding: 32, textAlign: "center", color: "#475569", fontSize: 12 }}>
                  <span className="spinner"></span>querying coral sources…
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#475569", fontSize: 12 }}>no issues found</div>
              ) : filtered.map(issue => (
                <div key={issue.number} className="issue-row fade-in">
                  <div style={{ fontSize: 11, color: "#475569", paddingTop: 2, fontFamily: "'DM Mono',monospace" }}>
                    #{issue.number}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 6, lineHeight: 1.4 }}>
                      {issue.title}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <Pill bg={S_COLOR[issue.status]+"22"} color={S_COLOR[issue.status]} border={S_COLOR[issue.status]+"44"}>
                        {S_LABEL[issue.status]}
                      </Pill>
                      {issue.pr && (
                        <Pill bg="#6366f122" color="#818cf8" border="#6366f144">
                          PR #{issue.pr.number}
                          {issue.pr.state ? ` · ${issue.pr.state}` : ""}
                        </Pill>
                      )}
                      {issue.slackChannel?.name && (
                        <Pill bg="#f59e0b22" color="#f59e0b" border="#f59e0b44">
                          #{issue.slackChannel.name}
                        </Pill>
                      )}
                      {issue.linearIssue?.title && (
                        <Pill bg="#34d39922" color="#34d399" border="#34d39944">
                          {issue.linearIssue.identifier ? `${issue.linearIssue.identifier} · ` : ""}
                          {issue.linearIssue.title.length > 28 ? issue.linearIssue.title.slice(0,28)+"…" : issue.linearIssue.title}
                        </Pill>
                      )}
                      {issue.linearIssue?.priority_label && issue.linearIssue.priority_label !== "No priority" && (
                        <Pill bg="#ffffff0a" color="#64748b" border="#ffffff11">
                          {issue.linearIssue.priority_label}
                        </Pill>
                      )}
                    </div>
                  </div>
                  {timeAgo(issue.created_at) && (
                    <div style={{ fontSize: 10, color: "#475569", whiteSpace: "nowrap", paddingTop: 2 }}>
                      {timeAgo(issue.created_at)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ textAlign: "center", fontSize: 10, color: "#1e2a3a", paddingBottom: 16 }}>
          built with coral sql · pirates of the coral-bean hackathon · may 2026
        </div>
      </div>
    </div>
  );
}