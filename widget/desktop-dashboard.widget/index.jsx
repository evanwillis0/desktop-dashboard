// desktop-dashboard: Übersicht widget.
// Reads everything from the local server (backend/dashboard/server.py) and draws one card per source.

import { run } from "uebersicht";

const API = "http://127.0.0.1:8787";

// Ask the server for new data every minute. (The server itself refreshes
// each service on its own, slower timer, so this is cheap.)
export const refreshFrequency = 60 * 1000;

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

const refreshNow = async (dispatch) => {
  dispatch({ type: "REFRESHING" });
  try {
    await fetch(`${API}/api/refresh`, { method: "POST" });
  } finally {
    await loadAll(dispatch);
  }
};

export const initialState = { data: null, offline: false, refreshing: false, gmailTab: null, calendarOffset: 0 };

export const updateState = (event, previous) => {
  switch (event.type) {
    case "DATA":
      // Keep UI choices (like the selected Gmail tab) when new data arrives.
      return { ...previous, data: event.data, offline: false, refreshing: false };
    case "OFFLINE":
      return { ...previous, offline: true, refreshing: false };
    case "REFRESHING":
      return { ...previous, refreshing: true };
    case "SELECT_GMAIL_TAB":
      return { ...previous, gmailTab: event.label };
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

const styles = {
  card: {
    width: 340,
    padding: "16px 18px",
    borderRadius: 16,
    background: "rgba(20, 22, 28, 0.62)",
    backdropFilter: "blur(24px) saturate(140%)",
    WebkitBackdropFilter: "blur(24px) saturate(140%)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.25)",
  },
  header: { display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 15, fontWeight: 600, letterSpacing: 0.2 },
  meta: { fontSize: 11, color: "rgba(255,255,255,0.5)", display: "flex", gap: 8, alignItems: "center" },
  refresh: { cursor: "pointer", fontSize: 13, color: "rgba(255,255,255,0.6)", userSelect: "none" },
  course: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "rgba(255,255,255,0.55)",
    margin: "12px 0 6px",
  },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "7px 10px",
    marginBottom: 6,
    borderRadius: 8,
    background: "rgba(255,255,255,0.04)",
    cursor: "pointer",
  },
  itemTitle: { fontSize: 13, fontWeight: 500 },
  itemDue: { fontSize: 11.5, color: "rgba(255,255,255,0.6)" },
  oneLine: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  allClear: { fontSize: 12.5, color: "#7fd49b" },
  warning: { fontSize: 11.5, color: "#ffb547", marginTop: 8 },
  empty: { fontSize: 13, color: "rgba(255,255,255,0.6)" },
};

// ---------- Cards ----------

const Card = ({ title, source, refreshing, onRefresh, children, width }) => (
  <div style={{ ...styles.card, ...(width ? { width } : {}) }}>
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

const GitHubCard = ({ source, refreshing, onRefresh }) => {
  const data = (source && source.data) || {};
  const notifications = data.notifications || [];
  const pullRequests = data.pull_requests || [];
  const repos = data.repos || [];
  const loading = source && source.status === "pending";

  return (
    <Card title="GitHub" source={source} refreshing={refreshing} onRefresh={onRefresh}>
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
          color={repo.ci === "failing" ? "#ff6b6b" : "rgba(255,255,255,0.25)"}
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

const MAX_SCORES = 5;
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
  const fromCanvas = ((canvas && canvas.scores) || [])  // filled in once Canvas login is set up
    .map((s) => ({ key: `cv-${s.url}`, source: "canvas", title: s.title, course: courseKey(s.course),
                   earned: s.earned, total: s.total, when: s.graded_at, fallback: s.due_at,
                   fresh: s.newly_graded, url: s.url }));
  const order = (a, b) =>
    (b.when || "").localeCompare(a.when || "") || (b.fallback || "").localeCompare(a.fallback || "");
  return [...fromGradescope, ...fromCanvas].sort(order).slice(0, MAX_SCORES);
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
  const grades = (canvas && canvas.grades) || {};  // { CMSC250: { score: 93.4 } } once Canvas login is set up

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
                {grade && grade.score != null ? `${grade.score}%` : items.length === 0 ? "nothing due" : ""}
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
          color="rgba(255,255,255,0.25)"
          title={<span>{s.fresh && pill("GRADED", "#16a34a")}{s.title}</span>}
          details={`${courseLabel(s.course)} · ${SOURCE_NAMES[s.source]} · ${scoreText(s)}`}
          onClick={() => openLink(s.url, s.source)}
          tooltip={`Open in ${SOURCE_NAMES[s.source]}`}
        />
      ))}
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
  color: active ? "#fff" : "rgba(255,255,255,0.6)",
  background: active ? "rgba(255,255,255,0.12)" : "transparent",
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
                {a.error && <span style={{ color: "#ffb547" }}>⚠</span>}
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
          {account.messages.map((m) => (
            <div
              key={m.url}
              style={{ ...styles.item, borderLeft: `3px solid ${m.unread ? GITHUB_BLUE : "rgba(255,255,255,0.15)"}` }}
              onClick={() => openInProfile(m.url, account.chrome_profile)}
              title={m.snippet}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ ...styles.itemTitle, ...styles.oneLine, fontWeight: m.unread ? 650 : 400 }}>{m.from}</span>
                <span style={{ ...styles.itemDue, flexShrink: 0 }}>{timeAgo(m.received_at)}</span>
              </div>
              <div style={{ ...styles.oneLine, fontSize: 12.5, fontWeight: m.unread ? 550 : 400,
                            color: m.unread ? "#f2f3f5" : "rgba(255,255,255,0.7)" }}>
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

// ----- Calendar (time grid) -----

const CAL_DAYS = 3; // columns shown at once
const CAL_MAX_OFFSET = 7 - CAL_DAYS; // the server sends 7 days of events
const PX_PER_HOUR = 34;
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
  background: "rgba(255,255,255,0.08)",
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
              <div style={{ fontSize: 11, color: isToday ? "#ff8a80" : "rgba(255,255,255,0.55)", fontWeight: 600,
                            textTransform: "uppercase", letterSpacing: 0.6 }}>{weekday}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: isToday ? "#ff8a80" : "#f2f3f5" }}>{date}</div>
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

      {/* Time grid */}
      <div style={{ position: "relative", height: gridHeight, marginTop: 4 }}>
        {hours.map((h) => (
          <div key={h} style={{ position: "absolute", top: (h - firstHour) * PX_PER_HOUR, left: 0, right: 0 }}>
            <div style={{ position: "absolute", left: 0, width: GUTTER - 6, top: -6, textAlign: "right",
                          fontSize: 10, color: "rgba(255,255,255,0.45)" }}>{h < lastHour ? hourLabel(h) : ""}</div>
            <div style={{ marginLeft: GUTTER, borderTop: "1px solid rgba(255,255,255,0.07)" }} />
          </div>
        ))}

        <div style={{ position: "absolute", top: 0, bottom: 0, left: GUTTER, right: 0, display: "flex" }}>
          {columns.map(({ day, timed }) => {
            const isToday = daysUntil(day) === 0;
            const nowTop = topFor(now, day);
            return (
              <div key={day} style={{ flex: 1, position: "relative", borderLeft: "1px solid rgba(255,255,255,0.07)" }}>
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
                        <div style={{ ...styles.oneLine, fontSize: 10, lineHeight: "13px", color: "rgba(255,255,255,0.75)" }}>
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

      {source && source.status === "pending" && <div style={{ ...styles.empty, marginTop: 8 }}>Loading…</div>}
    </Card>
  );
};

// ---------- Layout ----------

// Where the dashboard sits on the desktop, and its base text style.
export const className = `
  top: 48px;
  left: 48px;
  color: #f2f3f5;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif;
  -webkit-font-smoothing: antialiased;
`;

export const render = ({ data, offline, refreshing, gmailTab, calendarOffset }, dispatch) => {
  const onRefresh = () => refreshNow(dispatch);
  const column = { display: "flex", flexDirection: "column", gap: 16 };

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
    // Three columns: what's on today | what's due + code | mail.
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <div style={column}>
        <CalendarCard
          source={data && data.calendar}
          offset={calendarOffset}
          onOffset={(offset) => dispatch({ type: "SET_CALENDAR_OFFSET", offset })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </div>
      <div style={column}>
        <CourseworkCard
          canvasSource={data && data.canvas}
          gradescopeSource={data && data.gradescope}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      </div>
      <div style={column}>
        <GmailCard
          source={data && data.gmail}
          selected={gmailTab}
          onSelect={(label) => dispatch({ type: "SELECT_GMAIL_TAB", label })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <GitHubCard source={data && data.github} refreshing={refreshing} onRefresh={onRefresh} />
      </div>
    </div>
  );
};
