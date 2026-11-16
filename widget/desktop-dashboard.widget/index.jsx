// desktop-dashboard: Übersicht widget.
// Reads everything from the local server (backend/dashboard/server.py) and draws one card per source.

import { run } from "uebersicht";

const API = "http://127.0.0.1:8787";

// Re-read the server's data every 15 seconds; this also keeps the center clock current.
// (The server refreshes each service on its own, slower timer, so this is cheap.)
export const refreshFrequency = 15 * 1000;

// ---------- Data ----------

const loadAll = async (dispatch) => {
  try {
    const response = await fetch(`${API}/api/all`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dispatch({ type: "DATA", data: await response.json() });
  } catch (error) {
    dispatch({ type: "OFFLINE" });
  }
};

export const command = loadAll;

const MIN_REFRESH_MS = 1200; // keep the refresh animation on at least this long, so it never just flickers
const DONE_MS = 1800; // how long the bubble says "Updated ✓" afterwards

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const refreshNow = async (dispatch) => {
  dispatch({ type: "REFRESHING", at: Date.now() });
  try {
    await Promise.all([fetch(`${API}/api/refresh`, { method: "POST" }), wait(MIN_REFRESH_MS)]);
  } catch (error) {
    // Server unreachable; loadAll below shows the offline state.
  }
  await loadAll(dispatch);
  dispatch({ type: "REFRESHED", at: Date.now() });
  setTimeout(() => dispatch({ type: "REFRESH_SETTLED" }), DONE_MS);
};

// Note: Übersicht keeps old state when the code changes, so new fields here may be
// missing at runtime; every component must cope with them being undefined.
export const initialState = {
  data: null, offline: false, refreshing: false, gmailTab: null, calendarOffset: 0, piazzaTab: null,
  refreshStartedAt: null, refreshedAt: null,
};

// A refresh started by a click counts as running until it finishes (not just until the next
// 15-second reload), but never longer than this, in case the code reloaded mid-refresh.
const REFRESH_TIMEOUT_MS = 90 * 1000;

const isRefreshing = (state) =>
  !!state.refreshing && Number.isFinite(state.refreshStartedAt) && Date.now() - state.refreshStartedAt < REFRESH_TIMEOUT_MS;

export const updateState = (event, previous) => {
  switch (event.type) {
    case "DATA":
      // Keep UI choices (like the selected Gmail tab) when new data arrives.
      // (A click-started refresh stays on until REFRESHED, even if a regular reload lands first.)
      return { ...previous, data: event.data, offline: false };
    case "OFFLINE":
      return { ...previous, offline: true };
    case "REFRESHING":
      return { ...previous, refreshing: true, refreshStartedAt: event.at, refreshedAt: null };
    case "REFRESHED":
      return { ...previous, refreshing: false, refreshedAt: event.at };
    case "REFRESH_SETTLED":
      return { ...previous, refreshedAt: null };
    case "SELECT_GMAIL_TAB":
      return { ...previous, gmailTab: event.label };
    case "SELECT_PIAZZA_TAB":
      return { ...previous, piazzaTab: event.id };
    case "SET_CALENDAR_OFFSET":
      return { ...previous, calendarOffset: event.offset };
    default:
      return previous;
  }
};

// ---------- Helpers ----------

// Which Chrome profile each source's links open in. Folder names come from
// ~/Library/Application Support/Google/Chrome/Local State:
//   "Default" = personal (gmail.com), "Profile 1" = UMD (terpmail), "Profile 2" = NOVA (vccs.edu)
// A source not listed here opens in your default browser.
// (Gmail tabs get their profile from the server, one per account.)
const CHROME_PROFILE = {
  canvas: "Profile 1",
  github: "Default",
  calendar: "Profile 1",
  gradescope: "Profile 1",
  piazza: "Profile 1",
};

const shellQuote = (text) => `'${text.replace(/'/g, "'\\''")}'`;

// Open links outside the widget (a plain <a href> would load inside the widget).
const openInProfile = (url, profile) => {
  if (!url || !url.startsWith("https://")) return;
  if (profile) {
    run(`open -na "Google Chrome" --args --profile-directory=${shellQuote(profile)} ${shellQuote(url)}`);
  } else {
    run(`open ${shellQuote(url)}`);
  }
};

const openLink = (url, source) => openInProfile(url, CHROME_PROFILE[source]);

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const daysUntil = (due) => Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);

const relativeDay = (due) => {
  const days = daysUntil(due);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
};

// Red: due within 24h. Amber: within 3 days. Green: later.
const urgencyColor = (due) => {
  const hours = (new Date(due) - new Date()) / 3600000;
  if (hours < 24) return "#ff6b6b";
  if (hours < 72) return "#ffb547";
  return "#7fd49b";
};

const timeAgo = (iso) => {
  const minutes = Math.round((new Date() - new Date(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

const updatedAgo = (iso) => (iso ? timeAgo(iso) : "not loaded yet");

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------- Styles ----------

// Panel theme: glossy near-white panels with dark text.
const INK = "#1c1e22"; // main text
const INK_SOFT = "rgba(28, 30, 34, 0.62)"; // secondary text (dates, previews)
const INK_FAINT = "rgba(28, 30, 34, 0.45)"; // labels, hour marks
const LINE = "rgba(28, 30, 34, 0.08)"; // grid lines, dividers
const TILE = "rgba(28, 30, 34, 0.05)"; // item rows on a panel
const TILE_ACTIVE = "rgba(28, 30, 34, 0.1)"; // selected tab, buttons
const NEUTRAL_EDGE = "rgba(28, 30, 34, 0.18)"; // row edge when nothing is urgent
const OK_GREEN = "#15803d"; // readable green on white
const WARN_AMBER = "#b45309"; // readable amber on white
const TODAY_RED = "#e5484d";

const styles = {
  card: {
    position: "relative",
    overflow: "hidden",
    width: 340,
    padding: "16px 18px",
    borderRadius: 16,
    color: INK,
    // See-through frosted glass: lighter fill, stronger blur so text stays readable over the wallpaper.
    background: "linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(244,246,249,0.66) 50%, rgba(232,235,240,0.6) 100%)",
    backdropFilter: "blur(30px) saturate(170%)",
    WebkitBackdropFilter: "blur(30px) saturate(170%)",
    border: "1px solid rgba(255, 255, 255, 0.9)",
    boxShadow: [
      "inset 0 2px 0 rgba(255,255,255,0.95)", // crisp bright top edge
      "inset 0 0 0 1px rgba(255,255,255,0.35)", // glassy rim all around
      "inset 0 -1px 0 rgba(0,0,0,0.08)", // soft bottom edge
      "0 16px 38px rgba(0,0,0,0.30)", // lift off the wallpaper
      "0 2px 6px rgba(0,0,0,0.14)",
    ].join(", "),
  },
  // The gloss: a diagonal light streak (like light catching glass) over a strong top sheen.
  gloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: [
      "linear-gradient(115deg, rgba(255,255,255,0) 28%, rgba(255,255,255,0.32) 38%, rgba(255,255,255,0.08) 46%, rgba(255,255,255,0) 52%)",
      "linear-gradient(180deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.35) 22%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0) 60%)",
    ].join(", "),
    pointerEvents: "none",
  },
  content: { position: "relative" }, // sits above the gloss
  header: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 15, fontWeight: 650, letterSpacing: 0.2 },
  meta: { fontSize: 11, color: INK_FAINT, display: "flex", gap: 8, alignItems: "center" },
  refresh: { cursor: "pointer", fontSize: 13, color: INK_SOFT, userSelect: "none" },
  course: {
    fontSize: 11,
    fontWeight: 650,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: INK_SOFT,
    margin: "12px 0 6px",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "7px 10px",
    marginBottom: 6,
    borderRadius: 8,
    background: TILE,
    cursor: "pointer",
  },
  itemTitle: { fontSize: 13, fontWeight: 550 },
  itemDue: { fontSize: 11.5, color: INK_SOFT },
  oneLine: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  allClear: { fontSize: 12.5, color: OK_GREEN },
  warning: { fontSize: 11.5, color: WARN_AMBER, marginTop: 8 },
  empty: { fontSize: 13, color: INK_SOFT },
};

// ---------- Cards ----------

const Card = ({ title, source, refreshing, onRefresh, children, width }) => (
  <div style={{ ...styles.card, ...(width ? { width } : {}) }}>
    <div style={styles.gloss} />
    <div style={styles.content}>
    <div style={styles.header}>
      <div style={styles.title}>{title}</div>
      <div style={styles.meta}>
        <span>{refreshing ? "refreshing…" : updatedAgo(source && source.updated_at)}</span>
        <span style={styles.refresh} onClick={onRefresh} title="Refresh now">↻</span>
      </div>
    </div>
    {children}
    {source && source.status === "error" && (
      <div style={styles.warning}>⚠ Couldn't refresh: {source.error}</div>
    )}
    </div>
  </div>
);

const GITHUB_BLUE = "#6aa8ff";
const repoName = (fullName) => fullName.split("/").pop();

const prDetails = (pr) => {
  const parts = [`#${pr.number}`, repoName(pr.repo)];
  if (pr.role === "reviewer") parts.push("review requested");
  if (pr.draft) parts.push("draft");
  if (pr.review === "APPROVED") parts.push("approved");
  if (pr.review === "CHANGES_REQUESTED") parts.push("changes requested");
  if (pr.ci) parts.push(`CI ${pr.ci}`);
  return parts.join(" · ");
};

// Red: CI failing. Amber: someone is waiting on you. Blue: everything else.
const prColor = (pr) => {
  if (pr.ci === "failing") return "#ff6b6b";
  if (pr.role === "reviewer" || pr.review === "CHANGES_REQUESTED") return "#ffb547";
  return GITHUB_BLUE;
};

const notificationColor = (n) =>
  ["Review requested", "Mentioned", "Assigned", "Security alert"].includes(n.reason) ? "#ffb547" : GITHUB_BLUE;

const Row = ({ color, title, details, onClick, tooltip }) => (
  <div style={{ ...styles.item, borderLeft: `3px solid ${color}` }} onClick={onClick} title={tooltip}>
    <div style={{ ...styles.itemTitle, ...styles.oneLine }}>{title}</div>
    <div style={{ ...styles.itemDue, ...styles.oneLine }}>{details}</div>
  </div>
);

const GitHubCard = ({ source, refreshing, onRefresh, width }) => {
  const data = (source && source.data) || {};
  const notifications = data.notifications || [];
  const pullRequests = data.pull_requests || [];
  const repos = (data.repos || []).slice(0, 2);  // two keeps the left column clear of the Dock
  const loading = source && source.status === "pending";

  return (
    <Card title="GitHub" source={source} refreshing={refreshing} onRefresh={onRefresh} width={width}>
      <div style={{ ...styles.course, marginTop: 0 }}>Needs you</div>
      {loading && <div style={styles.empty}>Loading…</div>}
      {!loading && notifications.length === 0 && pullRequests.length === 0 && (
        <div style={styles.allClear}>✓ No unread notifications or open PRs</div>
      )}
      {notifications.map((n) => (
        <Row
          key={`n-${n.url}-${n.updated_at}`}
          color={notificationColor(n)}
          title={n.title}
          details={`${n.reason} · ${repoName(n.repo)} · ${timeAgo(n.updated_at)}`}
          onClick={() => openLink(n.url, "github")}
          tooltip="Open on GitHub"
        />
      ))}
      {pullRequests.map((pr) => (
        <Row
          key={`pr-${pr.url}`}
          color={prColor(pr)}
          title={pr.title}
          details={prDetails(pr)}
          onClick={() => openLink(pr.url, "github")}
          tooltip="Open pull request"
        />
      ))}

      {repos.length > 0 && <div style={styles.course}>Recent repos</div>}
      {repos.map((repo) => (
        <Row
          key={repo.url}
          color={repo.ci === "failing" ? "#ff6b6b" : NEUTRAL_EDGE}
          title={repoName(repo.name)}
          details={[
            // Short facts first so a long commit message can't push them out of view.
            `pushed ${timeAgo(repo.pushed_at)}`,
            repo.ci ? `CI ${repo.ci}` : null,
            repo.open_issues ? plural(repo.open_issues, "issue") : null,
            repo.open_prs ? plural(repo.open_prs, "PR") : null,
            repo.last_commit || "No commits",
          ].filter(Boolean).join(" · ")}
          onClick={() => openLink(repo.url, "github")}
          tooltip={repo.last_commit || repo.name}
        />
      ))}
    </Card>
  );
};

// ----- Coursework (Canvas + Gradescope) -----

const MAX_SCORES = 2;
const SOURCE_NAMES = { canvas: "Canvas", gradescope: "Gradescope" };

// "CMSC 250-010X", "CMSC250", "MATH-241" -> "CMSC250", so both sites' names for a class match.
const courseKey = (name) => {
  const compact = (name || "").toUpperCase().replace(/[\s\-_]/g, "");
  const match = compact.match(/^([A-Z]{3,4})(\d{3}[A-Z]?)/);
  return match ? match[1] + match[2] : compact || "OTHER";
};

// "CMSC250" -> "CMSC 250" for headings.
const courseLabel = (key) => key.replace(/^([A-Z]{3,4})(\d)/, "$1 $2");

const sameTitle = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

// One status line for a card fed by several sources: oldest update time, any errors named.
const combineSources = (named) => {
  const present = named.filter(([, s]) => s);
  if (present.length === 0) return null;
  const errors = present.filter(([, s]) => s.status === "error").map(([name, s]) => `${name}: ${s.error}`);
  const times = present.map(([, s]) => s.updated_at).filter(Boolean).sort();
  return {
    status: errors.length ? "error" : present.some(([, s]) => s.status === "pending") ? "pending" : "ok",
    updated_at: times[0] || null,
    error: errors.join(" · "),
  };
};

const upcomingItems = (canvas, gradescope) => {
  const fromGradescope = ((gradescope && gradescope.assignments) || [])
    .filter((a) => a.open)
    .map((a) => ({ key: `gs-${a.key}`, source: "gradescope", title: a.title, course: courseKey(a.course),
                   due: a.due_at, allDay: false, url: a.url, status: a.status, isNew: a.is_new }));
  const fromCanvas = ((canvas && canvas.assignments) || [])
    .map((a) => ({ key: `cv-${a.url}`, source: "canvas", title: a.title, course: courseKey(a.course),
                   due: a.due, allDay: a.all_day, url: a.url, status: null, isNew: false }))
    // Some classes post the same assignment on both sites; keep the Gradescope copy (it knows if you submitted).
    .filter((c) => !fromGradescope.some((g) => g.course === c.course && sameTitle(g.title, c.title)));
  return [...fromGradescope, ...fromCanvas].sort((a, b) => new Date(a.due) - new Date(b.due));
};

const scoreItems = (canvas, gradescope) => {
  const fromGradescope = ((gradescope && gradescope.assignments) || [])
    .filter((a) => a.status === "graded")
    .map((a) => ({ key: `gs-${a.key}`, source: "gradescope", title: a.title, course: courseKey(a.course),
                   earned: a.earned, total: a.total, when: a.graded_seen, fallback: a.due_at,
                   fresh: a.newly_graded, url: a.url }));
  const fromCanvas = ((canvas && canvas.scores) || [])
    .map((s) => ({ key: `cv-${s.url}`, source: "canvas", title: s.title, course: courseKey(s.course),
                   earned: s.earned, total: s.total, when: s.graded_at, fallback: s.due_at,
                   fresh: s.newly_graded, url: s.url }));
  // Some classes copy Gradescope grades into Canvas. Keep the Canvas copy: it knows when it was graded.
  const gradescopeOnly = fromGradescope.filter(
    (g) => !fromCanvas.some((c) => c.course === g.course && sameTitle(c.title, g.title))
  );
  const order = (a, b) =>
    (b.when || "").localeCompare(a.when || "") || (b.fallback || "").localeCompare(a.fallback || "");
  return [...gradescopeOnly, ...fromCanvas].sort(order).slice(0, MAX_SCORES);
};

const scoreText = (s) => {
  if (s.earned == null) return "graded";
  const pct = s.total ? ` · ${Math.round((s.earned / s.total) * 100)}%` : "";
  return `${s.earned} / ${s.total}${pct}`;
};

const pill = (text, background) => (
  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, padding: "1px 5px", borderRadius: 6,
                 background, color: "#fff", marginRight: 6, verticalAlign: "1px" }}>{text}</span>
);

const itemDueLabel = (item) => {
  const due = new Date(item.due);
  const day = due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${item.allDay ? day : `${day}, ${clock(due)}`} · ${relativeDay(due)}`;
};

const CourseworkCard = ({ canvasSource, gradescopeSource, refreshing, onRefresh }) => {
  const canvas = canvasSource && canvasSource.data;
  const gradescope = gradescopeSource && gradescopeSource.data;
  const upcoming = upcomingItems(canvas, gradescope);
  const scores = scoreItems(canvas, gradescope);
  // Overall class scores from Canvas, keyed the same way as everything else ("CMSC250").
  const grades = {};
  Object.entries((canvas && canvas.grades) || {}).forEach(([name, g]) => { grades[courseKey(name)] = g; });

  // Every class from either site; classes with work due first (soonest first), then the rest.
  const classKeys = [...new Set([
    ...upcoming.map((i) => i.course),
    ...((gradescope && gradescope.courses) || []).map((c) => courseKey(c.name)),
    ...Object.keys(grades),
  ])];
  const firstDue = (key) => {
    const item = upcoming.find((i) => i.course === key);
    return item ? new Date(item.due).getTime() : Infinity;
  };
  classKeys.sort((a, b) => firstDue(a) - firstDue(b) || a.localeCompare(b));

  const source = combineSources([["Canvas", canvasSource], ["Gradescope", gradescopeSource]]);
  const loading = !canvas && !gradescope;
  const title = `Coursework${gradescope && gradescope.term ? ` · ${gradescope.term}` : ""}`;

  return (
    <Card title={title} source={source} refreshing={refreshing} onRefresh={onRefresh} width={370}>
      {loading && <div style={styles.empty}>Loading…</div>}
      {classKeys.map((key, i) => {
        const items = upcoming.filter((item) => item.course === key);
        const grade = grades[key];
        return (
          <div key={key}>
            <div style={{ ...styles.course, marginTop: i === 0 ? 0 : 12, display: "flex", justifyContent: "space-between" }}>
              <span>{courseLabel(key)}</span>
              <span style={{ textTransform: "none", letterSpacing: 0 }}>
                {[items.length === 0 ? "nothing due" : null,
                  grade && grade.score != null ? `${grade.score}%${grade.grade ? ` (${grade.grade})` : ""}` : null]
                  .filter(Boolean).join(" · ")}
              </span>
            </div>
            {items.map((item) => (
              <div key={item.key}
                   style={{ ...styles.item, borderLeft: `3px solid ${item.status === "submitted" ? "#7fd49b" : urgencyColor(item.due)}` }}
                   onClick={() => openLink(item.url, item.source)} title={`Open in ${SOURCE_NAMES[item.source]}`}>
                <div style={{ ...styles.itemTitle, ...styles.oneLine }}>
                  {item.isNew && pill("NEW", "#3b82f6")}
                  {item.title}
                </div>
                <div style={{ ...styles.itemDue, ...styles.oneLine }}>
                  {SOURCE_NAMES[item.source]} · {itemDueLabel(item)}{item.status === "submitted" ? " · ✓ submitted" : ""}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {scores.length > 0 && <div style={{ ...styles.course, marginTop: 16 }}>Recent scores</div>}
      {scores.map((s) => (
        <Row
          key={s.key}
          color={NEUTRAL_EDGE}
          title={<span>{s.fresh && pill("GRADED", "#16a34a")}{s.title}</span>}
          details={`${courseLabel(s.course)} · ${SOURCE_NAMES[s.source]} · ${scoreText(s)}`}
          onClick={() => openLink(s.url, s.source)}
          tooltip={`Open in ${SOURCE_NAMES[s.source]}`}
        />
      ))}
      {canvas && canvas.scores_error && (
        <div style={styles.warning}>⚠ Canvas grades: {canvas.scores_error}</div>
      )}
    </Card>
  );
};

// ----- Gmail -----

const badgeText = (n) => (n >= 100 ? "99+" : String(n));

const tabStyle = (active) => ({
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  padding: "5px 4px",
  borderRadius: 7,
  fontSize: 12,
  whiteSpace: "nowrap",
  fontWeight: active ? 600 : 500,
  cursor: "pointer",
  color: active ? INK : INK_SOFT,
  background: active ? TILE_ACTIVE : "transparent",
});

const badgeStyle = {
  fontSize: 10,
  fontWeight: 700,
  padding: "1px 5px",
  borderRadius: 8,
  background: "#e5534b",
  color: "#fff",
};

const GmailCard = ({ source, selected, onSelect, refreshing, onRefresh }) => {
  const accounts = (source && source.data && source.data.accounts) || [];
  const account = accounts.find((a) => a.label === selected) || accounts[0];

  return (
    <Card title="Gmail" source={source} refreshing={refreshing} onRefresh={onRefresh} width={390}>
      {!account && <div style={styles.empty}>Loading…</div>}
      {account && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {accounts.map((a) => (
              <div key={a.label} style={tabStyle(a === account)} onClick={() => onSelect(a.label)} title={a.email}>
                {a.name}
                {a.unread_recent > 0 && <span style={badgeStyle}>{badgeText(a.unread_recent)}</span>}
                {a.error && <span style={{ color: WARN_AMBER }}>⚠</span>}
              </div>
            ))}
          </div>

          <div
            style={{ ...styles.meta, justifyContent: "space-between", marginBottom: 8, cursor: "pointer" }}
            onClick={() => openInProfile(account.inbox_url, account.chrome_profile)}
            title="Open this inbox"
          >
            <span style={styles.oneLine}>{account.email}</span>
            <span>last 7 days ↗</span>
          </div>

          {account.error && <div style={styles.warning}>⚠ {account.error}</div>}
          {!account.error && account.messages.length === 0 && (
            <div style={styles.allClear}>✓ No mail in the last 7 days</div>
          )}
          {account.messages.slice(0, 5).map((m) => (
            <div
              key={`${m.url}-${m.received_at}`}  // two emails in one conversation share a URL
              style={{ ...styles.item, borderLeft: `3px solid ${m.unread ? GITHUB_BLUE : NEUTRAL_EDGE}` }}
              onClick={() => openInProfile(m.url, account.chrome_profile)}
              title={m.snippet}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...styles.itemTitle, ...styles.oneLine, fontWeight: m.unread ? 650 : 400 }}>{m.from}</span>
                <span style={{ ...styles.itemDue, flexShrink: 0 }}>{timeAgo(m.received_at)}</span>
              </div>
              <div style={{ ...styles.oneLine, fontSize: 12.5, fontWeight: m.unread ? 550 : 400,
                            color: m.unread ? INK : INK_SOFT }}>
                {m.subject}
              </div>
              <div style={{ ...styles.itemDue, ...styles.oneLine }}>{m.snippet}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

// ----- Clock panel: greeting, date, time, today's counts -----

const NAME = "Evan";
const SOON_HOURS = 48; // "due soon" = due within this many hours and not submitted

const greetingFor = (hour) =>
  hour < 5 ? "Up late" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 22 ? "Good evening" : "Up late";

const sum = (items, pick) => items.reduce((total, item) => total + (pick(item) || 0), 0);

const statTile = (color, active) => ({
  ...styles.item,
  cursor: "default",
  marginBottom: 0,
  padding: "10px 12px",
  borderLeft: `3px solid ${active ? color : NEUTRAL_EDGE}`,
});

// The big refresh bubble next to the time. Plain CSS (not inline styles) because it needs
// :hover, :active and keyframe animations.
//   resting:    black outline, black text
//   hover:      black bubble, white text
//   refreshing: stays black; a light sweeps across it and a soft ring pulses outward
//   done:       a quick pop with "Updated ✓", then back to resting
const REFRESH_CSS = `
  .dd-refresh {
    position: relative;
    overflow: hidden;
    flex: none;
    box-sizing: border-box;
    width: 176px;
    height: 40px; /* a bit under the digits' height (about 45px at the clock's 64px font) */
    border-radius: 20px;
    border: 2px solid ${INK};
    background: transparent;
    color: ${INK};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
    user-select: none;
    transition: background 0.18s ease, color 0.18s ease, transform 0.12s ease;
  }
  .dd-refresh:hover, .dd-refresh.is-busy, .dd-refresh.is-done {
    background: ${INK};
    color: #fff;
  }
  .dd-refresh:active { transform: scale(0.95); }
  .dd-refresh.is-busy { cursor: progress; animation: dd-ring 1.3s ease-out infinite; }
  .dd-refresh.is-busy::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: -60%;
    width: 50%;
    background: linear-gradient(100deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.35) 50%, rgba(255,255,255,0) 100%);
    animation: dd-sweep 1.1s ease-in-out infinite;
  }
  .dd-refresh.is-done { animation: dd-pop 0.45s ease-out; }
  @keyframes dd-sweep { from { left: -60%; } to { left: 110%; } }
  @keyframes dd-ring {
    0% { box-shadow: 0 0 0 0 rgba(28, 30, 34, 0.45); }
    100% { box-shadow: 0 0 0 14px rgba(28, 30, 34, 0); }
  }
  @keyframes dd-pop { 0% { transform: scale(0.94); } 55% { transform: scale(1.06); } 100% { transform: scale(1); } }
`;

const RefreshBubble = ({ busy, done, onRefresh }) => (
  <div
    className={`dd-refresh${busy ? " is-busy" : done ? " is-done" : ""}`}
    onClick={busy ? undefined : onRefresh}
    title="Refresh every source now"
  >
    {busy ? "Refreshing…" : done ? "Updated ✓" : "Refresh"}
  </div>
);

const ClockCard = ({ data, refreshing, refreshDone, onRefresh }) => {
  const now = new Date();
  const source = (name) => (data && data[name] && data[name].data) || null;

  const accounts = (source("gmail") || {}).accounts || [];
  const classes = (source("piazza") || {}).classes || [];
  const soon = upcomingItems(source("canvas"), source("gradescope")).filter((item) => {
    const hoursLeft = (new Date(item.due) - now) / 3600000;
    return item.status !== "submitted" && hoursLeft > 0 && hoursLeft <= SOON_HOURS;
  });

  const stats = [
    { n: sum(accounts, (a) => a.unread_today), label: "new emails", color: GITHUB_BLUE,
      tip: "Unread emails from the last 24 hours (all 4 inboxes)" },
    { n: soon.length, label: "due in 48 hours", color: "#ff6b6b",
      tip: "Assignments due in the next 48 hours that aren't submitted" },
    { n: (source("github") || {}).commits_today || 0, label: "commits today", color: "#7fd49b",
      tip: "Your commits in the last 24 hours" },
    { n: sum(classes, (c) => c.new_today), label: "new Piazza posts", color: "#ffb547",
      tip: "Unread Piazza posts from the last 24 hours" },
  ];

  return (
    <div style={{ ...styles.card, width: 470 }}>
      <style>{REFRESH_CSS}</style>
      <div style={styles.gloss} />
      <div style={styles.content}>
        <div style={styles.header}>
          <div style={styles.title}>{greetingFor(now.getHours())}, {NAME}</div>
          <div style={styles.meta}>
            {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", margin: "2px 0 14px" }}>
          <div style={{ fontSize: 64, fontWeight: 250, lineHeight: "68px", letterSpacing: -1.5 }}>
            {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </div>
          {/* Fills the space right of the time and centers the bubble in it. */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            <RefreshBubble busy={refreshing} done={refreshDone} onRefresh={onRefresh} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {stats.map((s) => (
            <div key={s.label} style={statTile(s.color, s.n > 0)} title={s.tip}>
              <div style={{ fontSize: 24, fontWeight: 650, lineHeight: "28px", color: s.n > 0 ? INK : INK_FAINT }}>{s.n}</div>
              <div style={styles.itemDue}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ----- Piazza -----

const PIAZZA_POSTS = 4;
const INSTRUCTOR_AMBER = "#ffb547";

const PiazzaCard = ({ source, selected, onSelect, refreshing, onRefresh }) => {
  const classes = (source && source.data && source.data.classes) || [];
  // `selected` may be undefined (fresh state) or a class that's gone: fall back to the first.
  const current = classes.find((c) => c.id === selected) || classes[0];
  const posts = current ? current.posts.slice(0, PIAZZA_POSTS) : [];

  return (
    <Card title="Piazza" source={source} refreshing={refreshing} onRefresh={onRefresh} width={390}>
      {!current && <div style={styles.empty}>{source && source.status === "pending" ? "Loading…" : "No active classes"}</div>}
      {current && (
        <div>
          <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
            {classes.map((c) => (
              <div key={c.id} style={tabStyle(c === current)} onClick={() => onSelect(c.id)} title={c.name}>
                {courseLabel(courseKey(c.name))}
                {c.unread > 0 && <span style={badgeStyle}>{c.unread_capped ? `${c.unread}+` : c.unread}</span>}
              </div>
            ))}
          </div>
          {posts.map((p) => (
            <div key={p.id}
                 style={{ ...styles.item,
                          borderLeft: `3px solid ${p.instructor ? INSTRUCTOR_AMBER : p.unread ? GITHUB_BLUE : NEUTRAL_EDGE}` }}
                 onClick={() => openLink(p.url, "piazza")} title={p.snippet}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...styles.itemTitle, ...styles.oneLine, fontWeight: p.unread ? 650 : 400 }}>
                  {p.pinned && "📌 "}
                  {p.instructor && pill("INSTRUCTOR", "#b7791f")}
                  {p.unanswered && pill("UNANSWERED", "#c2410c")}
                  {p.subject}
                </span>
                <span style={{ ...styles.itemDue, flexShrink: 0 }}>{p.updated ? timeAgo(p.updated) : ""}</span>
              </div>
              <div style={{ ...styles.itemDue, ...styles.oneLine }}>{p.snippet}</div>
            </div>
          ))}
          <div style={{ ...styles.meta, justifyContent: "flex-end", cursor: "pointer", marginTop: 2 }}
               onClick={() => openLink(current.url, "piazza")}>
            open {courseLabel(courseKey(current.name))} on Piazza ↗
          </div>
        </div>
      )}
    </Card>
  );
};

// ----- Calendar (time grid) -----

const CAL_DAYS = 3; // columns shown at once
const CAL_MAX_OFFSET = 7 - CAL_DAYS; // the server sends 7 days of events
const PX_PER_HOUR = 28;
const VISIBLE_UNTIL = 19; // the grid shows up to 7 PM; later hours are a scroll away
const SCROLL_ID = "dd-cal-scroll";

const LATER_TAGS_ID = "dd-cal-later";

const scrollToLater = () => {
  const el = document.getElementById(SCROLL_ID);
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
};

// Fade the "+N later" tags out once you've scrolled down to the evening (they'd cover it).
const onGridScroll = (event) => {
  const el = event.currentTarget;
  const tags = document.getElementById(LATER_TAGS_ID);
  if (tags) tags.style.opacity = el.scrollTop >= el.scrollHeight - el.clientHeight - 6 ? "0" : "1";
};

const laterTag = {
  pointerEvents: "auto",
  cursor: "pointer",
  fontSize: 10.5,
  fontWeight: 600,
  padding: "2px 8px",
  borderRadius: 9,
  background: "rgba(20, 22, 28, 0.85)",
  border: "1px solid rgba(255,255,255,0.18)",
  color: "#f2f3f5",
  userSelect: "none",
};
const GUTTER = 38; // width of the hour labels on the left
const HOUR_MS = 3600000;

const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

const clock = (d) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const hourLabel = (h) => (h === 0 || h === 24 ? "12a" : h === 12 ? "12p" : h < 12 ? `${h}a` : `${h - 12}p`);

const columnHeading = (day) => {
  const days = daysUntil(day);
  const weekday = days === 0 ? "Today" : days === 1 ? "Tomorrow" : day.toLocaleDateString(undefined, { weekday: "short" });
  return { weekday, date: day.getDate() };
};

// All-day events come as dates ("2026-11-16", end exclusive) in local time.
const allDayOn = (e, day) => {
  const start = new Date(`${e.start}T00:00:00`);
  const end = new Date(`${e.end}T00:00:00`);
  return start <= day && day < end;
};

// Timed events for one day, clipped to that day, with side-by-side "lanes" for overlaps.
const layoutDay = (events, day) => {
  const dayEnd = addDays(day, 1);
  const items = events
    .filter((e) => !e.all_day)
    .map((e) => ({ e, start: new Date(e.start), end: new Date(e.end) }))
    .filter((it) => it.end > day && it.start < dayEnd)
    .map((it) => ({ ...it, start: it.start < day ? day : it.start, end: it.end > dayEnd ? dayEnd : it.end }))
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // Group events that overlap (directly or through a chain) and give each a lane in its group.
  const placed = [];
  let group = [];
  let groupEnd = 0;
  const finishGroup = () => {
    const laneEnds = [];
    group.forEach((it) => {
      let lane = laneEnds.findIndex((end) => end <= it.start.getTime());
      if (lane === -1) lane = laneEnds.push(0) - 1;
      laneEnds[lane] = it.end.getTime();
      it.lane = lane;
    });
    group.forEach((it) => placed.push({ ...it, lanes: laneEnds.length }));
    group = [];
  };
  items.forEach((it) => {
    if (group.length && it.start.getTime() >= groupEnd) finishGroup();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.end.getTime());
  });
  if (group.length) finishGroup();
  return placed;
};

const navButton = {
  cursor: "pointer",
  padding: "2px 8px",
  borderRadius: 6,
  background: TILE_ACTIVE,
  fontSize: 12,
  userSelect: "none",
};

const CalendarCard = ({ source, offset: rawOffset, onOffset, refreshing, onRefresh }) => {
  // Übersicht keeps the old state when it reloads new widget code, so a setting added later
  // (like this one) can be missing. Treat anything that isn't a whole number as "today".
  const offset = Number.isInteger(rawOffset) ? rawOffset : 0;
  const events = (source && source.data && source.data.events) || [];
  const today = startOfDay(new Date());
  const days = Array.from({ length: CAL_DAYS }, (_, i) => addDays(today, offset + i));
  const columns = days.map((day) => ({
    day,
    timed: layoutDay(events, day),
    allDay: events.filter((e) => e.all_day && allDayOn(e, day)),
  }));

  // Hour range: 8 AM to 8 PM, stretched to fit any earlier or later events.
  let firstHour = 8;
  let lastHour = 20;
  columns.forEach(({ day, timed }) =>
    timed.forEach((it) => {
      firstHour = Math.min(firstHour, Math.floor((it.start - day) / HOUR_MS));
      lastHour = Math.max(lastHour, Math.ceil((it.end - day) / HOUR_MS));
    })
  );
  const gridHeight = (lastHour - firstHour) * PX_PER_HOUR;
  // Only up to VISIBLE_UNTIL (7 PM) is visible at once; the rest scrolls.
  const visibleHeight = Math.min(gridHeight, Math.max(VISIBLE_UNTIL - firstHour, 1) * PX_PER_HOUR);
  const scrolls = gridHeight > visibleHeight;
  // Per day: how many events start at or after VISIBLE_UNTIL (hidden until you scroll).
  const laterCounts = columns.map(({ day, timed }) =>
    timed.filter((it) => (it.start - day) / HOUR_MS >= VISIBLE_UNTIL).length
  );
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, i) => firstHour + i);
  const topFor = (date, day) => ((date - day) / HOUR_MS - firstHour) * PX_PER_HOUR;
  const now = new Date();
  const hasAllDay = columns.some((c) => c.allDay.length > 0);

  return (
    <Card title="Calendar" source={source} refreshing={refreshing} onRefresh={onRefresh} width={470}>
      {/* Navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ ...navButton, opacity: offset > 0 ? 1 : 0.35 }} onClick={() => onOffset(Math.max(0, offset - 1))}>‹</span>
        <span style={navButton} onClick={() => onOffset(0)}>Today</span>
        <span style={{ ...navButton, opacity: offset < CAL_MAX_OFFSET ? 1 : 0.35 }}
              onClick={() => onOffset(Math.min(CAL_MAX_OFFSET, offset + 1))}>›</span>
        <span style={{ ...styles.meta, marginLeft: "auto" }}>
          {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
          {days[CAL_DAYS - 1].toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        </span>
      </div>

      {/* Day headings */}
      <div style={{ display: "flex", paddingLeft: GUTTER }}>
        {columns.map(({ day }) => {
          const { weekday, date } = columnHeading(day);
          const isToday = daysUntil(day) === 0;
          return (
            <div key={day} style={{ flex: 1, textAlign: "center", paddingBottom: 6 }}>
              <div style={{ fontSize: 11, color: isToday ? TODAY_RED : INK_SOFT, fontWeight: 600,
                            textTransform: "uppercase", letterSpacing: 0.6 }}>{weekday}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: isToday ? TODAY_RED : INK }}>{date}</div>
            </div>
          );
        })}
      </div>

      {/* All-day events */}
      {hasAllDay && (
        <div style={{ display: "flex", paddingLeft: GUTTER, marginBottom: 6 }}>
          {columns.map(({ day, allDay }) => (
            <div key={day} style={{ flex: 1, padding: "0 2px", display: "flex", flexDirection: "column", gap: 2 }}>
              {allDay.map((e) => (
                <div key={`${e.url}-${e.start}`} onClick={() => openLink(e.url, "calendar")} title={`${e.title} · ${e.calendar}`}
                     style={{ ...styles.oneLine, fontSize: 10.5, padding: "2px 5px", borderRadius: 4, cursor: "pointer",
                              background: `${e.color || GITHUB_BLUE}55`, borderLeft: `3px solid ${e.color || GITHUB_BLUE}` }}>
                  {e.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Time grid: a scrolling window that shows up to VISIBLE_UNTIL (7 PM) */}
      <div style={{ position: "relative", marginTop: 4 }}>
      <div id={SCROLL_ID} onScroll={onGridScroll}
           style={{ height: visibleHeight + 8, overflowY: scrolls ? "auto" : "hidden", overflowX: "hidden" }}>
      {/* marginTop leaves room for the first hour label, which sits half above its line */}
      <div style={{ position: "relative", height: gridHeight, marginTop: 7 }}>
        {hours.map((h) => (
          <div key={h} style={{ position: "absolute", top: (h - firstHour) * PX_PER_HOUR, left: 0, right: 0 }}>
            <div style={{ position: "absolute", left: 0, width: GUTTER - 6, top: -6, textAlign: "right",
                          fontSize: 10, color: INK_FAINT }}>{h < lastHour ? hourLabel(h) : ""}</div>
            <div style={{ marginLeft: GUTTER, borderTop: `1px solid ${LINE}` }} />
          </div>
        ))}

        <div style={{ position: "absolute", top: 0, bottom: 0, left: GUTTER, right: 0, display: "flex" }}>
          {columns.map(({ day, timed }) => {
            const isToday = daysUntil(day) === 0;
            const nowTop = topFor(now, day);
            return (
              <div key={day} style={{ flex: 1, position: "relative", borderLeft: `1px solid ${LINE}` }}>
                {timed.map((it) => {
                  const top = topFor(it.start, day);
                  const height = Math.max(16, topFor(it.end, day) - top - 2);
                  const color = it.e.color || GITHUB_BLUE;
                  const past = it.end < now;
                  return (
                    <div
                      key={`${it.e.url}-${it.e.start}`}
                      onClick={() => openLink(it.e.url, "calendar")}
                      title={`${it.e.title}\n${clock(it.start)} – ${clock(it.end)}${it.e.location ? `\n${it.e.location}` : ""}\n${it.e.calendar}`}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${(100 / it.lanes) * it.lane}% + 2px)`,
                        width: `calc(${100 / it.lanes}% - 4px)`,
                        background: `${color}${past ? "30" : "59"}`,
                        borderLeft: `3px solid ${color}`,
                        borderRadius: 5,
                        padding: "2px 5px",
                        overflow: "hidden",
                        cursor: "pointer",
                        opacity: past ? 0.6 : 1,
                      }}
                    >
                      <div style={{ ...styles.oneLine, fontSize: 11, fontWeight: 600, lineHeight: "14px" }}>{it.e.title}</div>
                      {height >= 30 && (
                        <div style={{ ...styles.oneLine, fontSize: 10, lineHeight: "13px", color: INK_SOFT }}>
                          {clock(it.start)}{it.e.location ? ` · ${it.e.location}` : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
                {isToday && nowTop >= 0 && nowTop <= gridHeight && (
                  <div style={{ position: "absolute", top: nowTop, left: -4, right: 0, height: 2, background: "#ff5f57", zIndex: 2 }}>
                    <div style={{ position: "absolute", left: -3, top: -3, width: 8, height: 8, borderRadius: 4, background: "#ff5f57" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      {/* "+N later" tags for days with events after VISIBLE_UNTIL; click to scroll down */}
      {scrolls && laterCounts.some((n) => n > 0) && (
        <div id={LATER_TAGS_ID}
             style={{ position: "absolute", bottom: 6, left: GUTTER, right: 10, display: "flex", pointerEvents: "none",
                      transition: "opacity 0.2s" }}>
          {laterCounts.map((n, i) => (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              {n > 0 && (
                <span style={laterTag} onClick={scrollToLater} title="Scroll to evening events">
                  +{n} later ↓
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      {source && source.status === "pending" && <div style={{ ...styles.empty, marginTop: 8 }}>Loading…</div>}
    </Card>
  );
};

// ---------- Layout ----------

const HALLWAY_ANGLE = 7; // degrees the side columns turn toward the middle (subtle)
const PERSPECTIVE = 1250; // viewing distance in px: smaller = deeper 3D effect (was 1600)
const SIDE_LIFT = 20; // how much higher the side columns sit than the middle one

// Where the dashboard sits on the desktop, and its base text style.
export const className = `
  top: 40px;
  left: 68px; /* centers the 1376pt-wide dashboard on a 1512pt screen */
  color: #f2f3f5;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  -webkit-font-smoothing: antialiased;

  /* Thin, subtle scrollbar for the calendar's scrolling grid */
  #dd-cal-scroll::-webkit-scrollbar { width: 5px; }
  #dd-cal-scroll::-webkit-scrollbar-thumb { background: rgba(28, 30, 34, 0.25); border-radius: 3px; }
  #dd-cal-scroll::-webkit-scrollbar-track { background: transparent; }
`;

export const render = (state, dispatch) => {
  const { data, offline, gmailTab, calendarOffset, piazzaTab } = state;
  const refreshing = isRefreshing(state);
  const refreshDone = !refreshing && Number.isFinite(state.refreshedAt) && Date.now() - state.refreshedAt < DONE_MS + 500;
  const onRefresh = () => {
    if (!refreshing) refreshNow(dispatch); // ignore extra clicks while one is running
  };
  const column = { display: "flex", flexDirection: "column", gap: 16 };
  // Hallway effect: the side columns turn slightly toward the middle, like walls you're
  // looking down. Each pivots on its outer edge, so its inner edge recedes.
  // They also sit SIDE_LIFT px higher than the middle column.
  const wall = { ...column, marginTop: -SIDE_LIFT };
  const leftWall = { ...wall, transform: `rotateY(${HALLWAY_ANGLE}deg)`, transformOrigin: "left center" };
  const rightWall = { ...wall, transform: `rotateY(-${HALLWAY_ANGLE}deg)`, transformOrigin: "right center" };

  if (offline && !data) {
    return (
      <div style={styles.card}>
        <div style={styles.title}>Dashboard server isn't running</div>
        <div style={{ ...styles.empty, marginTop: 6 }}>
          It starts at login. If it's stuck, check ~/Library/Logs/desktop-dashboard/server.log
        </div>
      </div>
    );
  }

  return (
    // Three columns: coursework + GitHub | calendar + center circle | messages.
    // `perspective` gives the side columns' rotation real depth (smaller = stronger effect).
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", perspective: PERSPECTIVE, perspectiveOrigin: "50% 45%" }}>
      <div style={leftWall}>
        <CourseworkCard
          canvasSource={data && data.canvas}
          gradescopeSource={data && data.gradescope}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <GitHubCard source={data && data.github} refreshing={refreshing} onRefresh={onRefresh} width={370} />
      </div>
      <div style={{ ...column, gap: 12 }}>
        <CalendarCard
          source={data && data.calendar}
          offset={calendarOffset}
          onOffset={(offset) => dispatch({ type: "SET_CALENDAR_OFFSET", offset })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <ClockCard data={data} refreshing={refreshing} refreshDone={refreshDone} onRefresh={onRefresh} />
      </div>
      <div style={rightWall}>
        <GmailCard
          source={data && data.gmail}
          selected={gmailTab}
          onSelect={(label) => dispatch({ type: "SELECT_GMAIL_TAB", label })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <PiazzaCard
          source={data && data.piazza}
          selected={piazzaTab}
          onSelect={(id) => dispatch({ type: "SELECT_PIAZZA_TAB", id })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </div>
    </div>
  );
};
