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

export const initialState = { data: null, offline: false, refreshing: false };

export const updateState = (event, previous) => {
  switch (event.type) {
    case "DATA":
      return { data: event.data, offline: false, refreshing: false };
    case "OFFLINE":
      return { ...previous, offline: true, refreshing: false };
    case "REFRESHING":
      return { ...previous, refreshing: true };
    default:
      return previous;
  }
};

// ---------- Helpers ----------

// Which Chrome profile each source's links open in. Folder names come from
// ~/Library/Application Support/Google/Chrome/Local State:
//   "Default" = personal (gmail.com), "Profile 1" = UMD (terpmail), "Profile 2" = NOVA (vccs.edu)
// A source not listed here opens in your default browser.
const CHROME_PROFILE = {
  canvas: "Profile 1",
};

const shellQuote = (text) => `'${text.replace(/'/g, "'\\''")}'`;

// Open links outside the widget (a plain <a href> would load inside the widget).
const openLink = (url, source) => {
  if (!url || !url.startsWith("https://")) return;
  const profile = CHROME_PROFILE[source];
  if (profile) {
    run(`open -na "Google Chrome" --args --profile-directory=${shellQuote(profile)} ${shellQuote(url)}`);
  } else {
    run(`open ${shellQuote(url)}`);
  }
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const daysUntil = (due) => Math.round((startOfDay(due) - startOfDay(new Date())) / 86400000);

const relativeDay = (due) => {
  const days = daysUntil(due);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
};

const dueLabel = (item) => {
  const due = new Date(item.due);
  const day = due.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (item.all_day) return day;
  const time = due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day}, ${time}`;
};

// Red: due within 24h. Amber: within 3 days. Green: later.
const urgencyColor = (due) => {
  const hours = (new Date(due) - new Date()) / 3600000;
  if (hours < 24) return "#ff6b6b";
  if (hours < 72) return "#ffb547";
  return "#7fd49b";
};

const updatedAgo = (iso) => {
  if (!iso) return "not loaded yet";
  const minutes = Math.round((new Date() - new Date(iso)) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

const groupBy = (items, key) =>
  items.reduce((groups, item) => {
    (groups[item[key]] = groups[item[key]] || []).push(item);
    return groups;
  }, {});

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
  warning: { fontSize: 11.5, color: "#ffb547", marginTop: 8 },
  empty: { fontSize: 13, color: "rgba(255,255,255,0.6)" },
};

// ---------- Cards ----------

const Card = ({ title, source, refreshing, onRefresh, children }) => (
  <div style={styles.card}>
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

const CanvasCard = ({ source, refreshing, onRefresh }) => {
  const assignments = (source && source.data && source.data.assignments) || [];
  const courses = groupBy(assignments, "course");

  return (
    <Card title="Canvas" source={source} refreshing={refreshing} onRefresh={onRefresh}>
      {assignments.length === 0 && (
        <div style={styles.empty}>{source && source.status === "pending" ? "Loading…" : "Nothing due 🎉"}</div>
      )}
      {Object.entries(courses).map(([course, items]) => (
        <div key={course}>
          <div style={styles.course}>{course}</div>
          {items.map((item) => (
            <div
              key={item.url}
              style={{ ...styles.item, borderLeft: `3px solid ${urgencyColor(item.due)}` }}
              onClick={() => openLink(item.url, "canvas")}
              title="Open in Canvas"
            >
              <div style={styles.itemTitle}>{item.title}</div>
              <div style={styles.itemDue}>
                {dueLabel(item)} · {relativeDay(new Date(item.due))}
              </div>
            </div>
          ))}
        </div>
      ))}
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

export const render = ({ data, offline, refreshing }, dispatch) => {
  const onRefresh = () => refreshNow(dispatch);

  if (offline && !data) {
    return (
      <div style={styles.card}>
        <div style={styles.title}>Dashboard server isn't running</div>
        <div style={{ ...styles.empty, marginTop: 6 }}>Start it with: python -m dashboard.server</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      <CanvasCard source={data && data.canvas} refreshing={refreshing} onRefresh={onRefresh} />
    </div>
  );
};
