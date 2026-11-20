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

// Notes are fetched once (then the notepad owns them). If the server is unreachable, try
// again on the next 15-second cycle; the notepad stays read-only until they arrive.
let notesLoaded = false;

const loadNotes = async (dispatch) => {
  if (notesLoaded) return;
  try {
    const response = await fetch(`${API}/api/notes`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const saved = await response.json();
    notesLoaded = true;
    dispatch({ type: "NOTES_LOADED", text: typeof saved.text === "string" ? saved.text : "" });
  } catch (error) {
    // Leave notesLoaded false; retried next cycle.
  }
};

// Canvas assignments you've marked as submitted (the feed can't tell). Re-read every cycle,
// so a change made elsewhere (say, the dashboard open in a browser) shows up here too.
const loadSubmitted = async (dispatch) => {
  try {
    const response = await fetch(`${API}/api/submitted`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (Array.isArray(body.urls)) dispatch({ type: "SUBMITTED", urls: body.urls });
  } catch (error) {
    // Keep the marks we have; retried next cycle.
  }
};

const setSubmitted = async (url, submitted, dispatch) => {
  dispatch({ type: "SUBMITTED_TOGGLE", url, submitted }); // show it right away
  try {
    const response = await fetch(`${API}/api/submitted`, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" }, // plain text: no extra permission check
      body: JSON.stringify({ url, submitted }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (Array.isArray(body.urls)) dispatch({ type: "SUBMITTED", urls: body.urls });
  } catch (error) {
    loadSubmitted(dispatch); // didn't save: go back to what the server has
  }
};

export const command = async (dispatch) => {
  await Promise.all([loadAll(dispatch), loadNotes(dispatch), loadSubmitted(dispatch)]);
};

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
  refreshStartedAt: null, refreshedAt: null, leftCompact: false, githubOpen: false,
  messagesView: "gmail", notesLoaded: false, notesText: "", notesVersion: 0, notesStatus: null,
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
    case "SET_LEFT_COMPACT":
      // Leaving compact mode also closes the GitHub dropdown, so next time starts folded.
      return { ...previous, leftCompact: event.compact, githubOpen: event.compact ? previous.githubOpen : false };
    case "TOGGLE_GITHUB":
      return { ...previous, githubOpen: !previous.githubOpen };
    case "SET_MESSAGES_VIEW":
      return { ...previous, messagesView: event.view };
    case "NOTES_LOADED":
      // A new version remounts the text box with the saved text.
      return { ...previous, notesLoaded: true, notesText: event.text, notesEmpty: event.text === "",
               notesVersion: (previous.notesVersion || 0) + 1 };
    case "NOTES_STATUS":
      return { ...previous, notesStatus: event.status };
    case "SUBMITTED":
      return { ...previous, submittedUrls: event.urls };
    case "SUBMITTED_TOGGLE": {
      const current = Array.isArray(previous.submittedUrls) ? previous.submittedUrls : [];
      const others = current.filter((u) => u !== event.url);
      return { ...previous, submittedUrls: event.submitted ? [...others, event.url] : others };
    }
    case "LOGIN_STARTED":
      return { ...previous, loginsStarted: { ...(previous.loginsStarted || {}), [event.site]: event.at } };
    case "NOTES_EMPTY":
      return { ...previous, notesEmpty: event.empty };
    case "NOTES_REPLACE":
      // Remount the text box with new text (clear, or undo a clear).
      return { ...previous, notesText: event.text, notesEmpty: event.text === "",
               notesVersion: (previous.notesVersion || 0) + 1 };
    case "NOTES_UNDO_OFFER":
      return { ...previous, notesUndo: event.text, notesUndoToken: event.token };
    case "NOTES_UNDO_EXPIRE":
      // A timer only expires the undo it was set for (not a newer one).
      if (event.token && event.token !== previous.notesUndoToken) return previous;
      return { ...previous, notesUndo: null, notesUndoToken: null };
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

// A panel whose body can fold away under its header (used by the left column: Coursework
// and GitHub). The body animates between full height and zero with a grid-rows transition.
// The data-* names let the left column measure each panel's full height (see fitLeftColumn).
const FOLD_MS = 450;

const FoldCard = ({ name, header, open, width, children }) => (
  <div style={{ ...styles.card, width }} data-fold-card={name}>
    <div style={styles.gloss} />
    <div style={styles.content}>
      <div data-fold-header={name}>{header}</div>
      <div data-fold={name} style={{ display: "grid", gridTemplateRows: open ? "1fr" : "0fr",
                                     transition: `grid-template-rows ${FOLD_MS}ms ease` }}>
        <div data-fold-inner={name} style={{ overflow: "hidden", minHeight: 0 }}>
          {/* The gap under the header lives inside the fold, so it folds away too. */}
          <div style={{ paddingTop: 12 }}>{children}</div>
        </div>
      </div>
    </div>
  </div>
);

// The standard header (title, "updated X ago", ↻), with no bottom margin (FoldCard adds the gap).
const CardHeader = ({ title, source, refreshing, onRefresh, onTitleClick, hint }) => (
  <div style={{ ...styles.header, marginBottom: 0 }}>
    <div style={{ ...styles.title, cursor: onTitleClick ? "pointer" : "default" }} onClick={onTitleClick}>{title}</div>
    <div style={styles.meta}>
      {hint ? <span style={{ cursor: "pointer" }} onClick={onTitleClick}>{hint}</span>
            : <span>{refreshing ? "refreshing…" : updatedAgo(source && source.updated_at)}</span>}
      <span style={styles.refresh} onClick={onRefresh} title="Refresh now">↻</span>
    </div>
  </div>
);

// ----- Warnings, with a one-click "Log in again" for expired site logins -----

const LOGIN_NAMES = { canvas: "Canvas", gradescope: "Gradescope", piazza: "Piazza" };
const LOGIN_WAIT_MS = 5 * 60 * 1000; // the login window gives up after 5 minutes

// Set on every render, so warnings deep inside any panel can start a login and know
// which logins are under way, without passing these through every component.
let currentDispatch = null;
let currentLoginsStarted = {};

const startLogin = async (site) => {
  if (currentDispatch) currentDispatch({ type: "LOGIN_STARTED", site, at: Date.now() });
  try {
    // Plain-text POST: no extra permission check needed. The server opens the login window.
    await fetch(`${API}/api/login/${site}`, { method: "POST" });
  } catch (error) {
    if (currentDispatch) currentDispatch({ type: "LOGIN_STARTED", site, at: null });
  }
};

// Shows a warning. "Logged out of <site>. Log in again: <command>" becomes
// "Logged out of <Site>" with a "Log in again ↗" link (or a reminder while the window is open).
const WarningLine = ({ text }) => {
  const match = (text || "").match(/^(.*?)Logged out of (canvas|gradescope|piazza)\b/);
  if (!match) return <div style={styles.warning}>⚠ {text}</div>;
  const [, prefix, site] = match;
  const startedAt = currentLoginsStarted[site];
  const waiting = Number.isFinite(startedAt) && Date.now() - startedAt < LOGIN_WAIT_MS;
  return (
    <div style={styles.warning}>
      ⚠ {prefix}Logged out of {LOGIN_NAMES[site]}.{" "}
      {waiting && <span>Finish logging in in the Chrome window that opened. </span>}
      {/* Always clickable: if the login window is still open, the server brings it to the
          front; if it was closed, a new one opens. */}
      <span style={{ fontWeight: 650, textDecoration: "underline", cursor: "pointer" }}
            onClick={() => startLogin(site)} title={`Open the ${LOGIN_NAMES[site]} login window`}>
        {waiting ? "Open it again ↗" : "Log in again ↗"}
      </span>
    </div>
  );
};

const SourceWarning = ({ source }) =>
  source && source.status === "error" ? <WarningLine text={`Couldn't refresh: ${source.error}`} /> : null;

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

// The GitHub panel's dropdown header, used when Coursework is too full for both panels:
// about twice the refresh bubble's height, with a counter and a chevron.
const DROPDOWN_HEADER_H = 46; // + the panel's 34px of padding and border = 80px when folded

const chevronStyle = (open) => ({
  width: 28,
  height: 28,
  borderRadius: 14,
  border: `1.5px solid ${INK}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flex: "none",
  transform: open ? "rotate(180deg)" : "none",
  transition: `transform ${FOLD_MS}ms ease`,
});

const GitHubCard = ({ source, refreshing, onRefresh, width, compact, open, onToggle }) => {
  const data = (source && source.data) || {};
  const notifications = data.notifications || [];
  const pullRequests = data.pull_requests || [];
  const repos = (data.repos || []).slice(0, 2);  // two keeps the left column clear of the Dock
  const loading = source && source.status === "pending";
  const waiting = notifications.length + pullRequests.length; // everything under "Needs you"

  const header = compact ? (
    <div style={{ height: DROPDOWN_HEADER_H, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
         onClick={onToggle} title={open ? "Fold GitHub away" : "Show GitHub"}>
      <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: 0.2 }}>GitHub</div>
      {waiting > 0 && (
        <span style={{ ...badgeStyle, fontSize: 12, padding: "2px 8px", borderRadius: 10 }}
              title="Unread notifications and open PRs">{badgeText(waiting)}</span>
      )}
      <div style={{ flex: 1 }} />
      <div style={chevronStyle(open)}>
        <svg width="12" height="8" viewBox="0 0 12 8" style={{ marginTop: 1 }}>
          <path d="M1 1.5 L6 6.5 L11 1.5" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  ) : (
    <CardHeader title="GitHub" source={source} refreshing={refreshing} onRefresh={onRefresh} />
  );

  return (
    <FoldCard name="github" header={header} open={!compact || open} width={width}>
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
      <SourceWarning source={source} />
    </FoldCard>
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

// `marked`: links of Canvas assignments you've marked as submitted (Gradescope knows on its own).
const upcomingItems = (canvas, gradescope, marked) => {
  const markedSet = new Set(Array.isArray(marked) ? marked : []);
  const fromGradescope = ((gradescope && gradescope.assignments) || [])
    .filter((a) => a.open)
    .map((a) => ({ key: `gs-${a.key}`, source: "gradescope", title: a.title, course: courseKey(a.course),
                   due: a.due_at, allDay: false, url: a.url, status: a.status, isNew: a.is_new }));
  const fromCanvas = ((canvas && canvas.assignments) || [])
    .map((a) => ({ key: `cv-${a.url}`, source: "canvas", title: a.title, course: courseKey(a.course),
                   due: a.due, allDay: a.all_day, url: a.url, isNew: false, markable: true,
                   status: markedSet.has(a.url) ? "submitted" : null }))
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

// Each class shows at most this many assignments; more scroll inside that class.
// Rows get fixed line heights so "two rows" is an exact height: 7 + 16 + 2 + 14 + 7 = 46px, plus 6px gap.
const ROWS_PER_CLASS = 2;
const COURSE_ROW_H = 46;
const COURSE_ROW_GAP = 6;
const courseRowTitle = { ...styles.itemTitle, ...styles.oneLine, lineHeight: "16px" };
const courseRowDue = { ...styles.itemDue, ...styles.oneLine, lineHeight: "14px" };

// The small round "mark as submitted" button on Canvas rows (Gradescope rows know on their own).
const MARK_SIZE = 22;
const markButtonStyle = (done) => ({
  position: "absolute",
  right: 10,
  top: (COURSE_ROW_H - MARK_SIZE) / 2,
  width: MARK_SIZE,
  height: MARK_SIZE,
  boxSizing: "border-box",
  borderRadius: MARK_SIZE / 2,
  border: `1.5px solid ${done ? OK_GREEN : "rgba(28, 30, 34, 0.35)"}`,
  background: done ? OK_GREEN : "transparent",
  color: done ? "#fff" : "rgba(28, 30, 34, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
});

const CourseworkCard = ({ canvasSource, gradescopeSource, refreshing, onRefresh, folded, onUnfold, marked, onMark }) => {
  const canvas = canvasSource && canvasSource.data;
  const gradescope = gradescopeSource && gradescopeSource.data;
  const upcoming = upcomingItems(canvas, gradescope, marked);
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
    <FoldCard
      name="coursework"
      open={!folded}
      width={370}
      header={
        <CardHeader title={title} source={source} refreshing={refreshing} onRefresh={onRefresh}
                    onTitleClick={folded ? onUnfold : undefined} hint={folded ? "show ▾" : null} />
      }
    >
      {loading && <div style={styles.empty}>Loading…</div>}
      {classKeys.map((key, i) => {
        const items = upcoming.filter((item) => item.course === key);
        const grade = grades[key];
        const scrolls = items.length > ROWS_PER_CLASS;
        return (
          <div key={key}>
            <div style={{ ...styles.course, marginTop: i === 0 ? 0 : 12, display: "flex", justifyContent: "space-between" }}>
              <span>{courseLabel(key)}</span>
              <span style={{ textTransform: "none", letterSpacing: 0 }}>
                {[items.length === 0 ? "nothing due" : null,
                  scrolls ? `${items.length} due · scroll` : null,
                  grade && grade.score != null ? `${grade.score}%${grade.grade ? ` (${grade.grade})` : ""}` : null]
                  .filter(Boolean).join(" · ")}
              </span>
            </div>
            <div className={scrolls ? "dd-scroll" : undefined}
                 style={scrolls ? { maxHeight: ROWS_PER_CLASS * (COURSE_ROW_H + COURSE_ROW_GAP), overflowY: "auto", paddingRight: 4, marginRight: -4 } : undefined}>
              {items.map((item) => (
                <div key={item.key}
                     style={{ ...styles.item, height: COURSE_ROW_H, boxSizing: "border-box", marginBottom: COURSE_ROW_GAP,
                              position: "relative", paddingRight: item.markable ? MARK_SIZE + 18 : 10,
                              borderLeft: `3px solid ${item.status === "submitted" ? "#7fd49b" : urgencyColor(item.due)}` }}
                     onClick={() => openLink(item.url, item.source)} title={`Open in ${SOURCE_NAMES[item.source]}`}>
                  <div style={courseRowTitle}>
                    {item.isNew && pill("NEW", "#3b82f6")}
                    {item.title}
                  </div>
                  <div style={courseRowDue}>
                    {SOURCE_NAMES[item.source]} · {itemDueLabel(item)}{item.status === "submitted" ? " · ✓ submitted" : ""}
                  </div>
                  {item.markable && (
                    <div
                      style={markButtonStyle(item.status === "submitted")}
                      title={item.status === "submitted" ? "Marked as submitted (click to undo)" : "Mark as submitted"}
                      onClick={(event) => {
                        event.stopPropagation(); // don't also open the assignment
                        onMark(item.url, item.status !== "submitted");
                      }}
                    >
                      ✓
                    </div>
                  )}
                </div>
              ))}
            </div>
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
      {canvas && canvas.scores_error && <WarningLine text={`Canvas grades: ${canvas.scores_error}`} />}
      <SourceWarning source={source} />
    </FoldCard>
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

// Gmail's side of the Messages panel: one tab per inbox.
const GmailBody = ({ source, selected, onSelect }) => {
  const accounts = (source && source.data && source.data.accounts) || [];
  const account = accounts.find((a) => a.label === selected) || accounts[0];

  return (
    <div>
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
      <SourceWarning source={source} />
    </div>
  );
};

// ----- Notepad -----
// Notes are saved by the dashboard server (data/notes.json), so they survive restarts.
// The text box is "uncontrolled": the browser owns what you type, and the 15-second redraws
// never touch it. It's remounted (notesVersion) only when notes are loaded from the server.

const NOTES_SAVE_DELAY_MS = 600; // save this long after you stop typing
let notesSaveTimer = null;

const saveNotes = (text, dispatch) => {
  clearTimeout(notesSaveTimer);
  dispatch({ type: "NOTES_STATUS", status: "saving" });
  notesSaveTimer = setTimeout(async () => {
    try {
      // Plain text (not JSON), so the browser sends it without an extra permission check.
      const response = await fetch(`${API}/api/notes`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: text,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      dispatch({ type: "NOTES_STATUS", status: "saved" });
    } catch (error) {
      dispatch({ type: "NOTES_STATUS", status: "error" });
    }
  }, NOTES_SAVE_DELAY_MS);
};

const NOTES_STATUS_TEXT = { saving: "saving…", saved: "saved ✓", error: "⚠ not saved (server offline?)" };
const NOTES_UNDO_MS = 6000; // how long "undo" stays after clearing

// Replace everything in the notepad (clear, or undo a clear) and save it.
const replaceNotes = (text, dispatch) => {
  dispatch({ type: "NOTES_REPLACE", text });
  saveNotes(text, dispatch);
};

const clearNotes = (dispatch) => {
  const box = document.querySelector(".dd-notes");
  const previous = box ? box.value : "";
  if (!previous) return;
  replaceNotes("", dispatch);
  const token = Date.now();
  dispatch({ type: "NOTES_UNDO_OFFER", text: previous, token });
  setTimeout(() => dispatch({ type: "NOTES_UNDO_EXPIRE", token }), NOTES_UNDO_MS);
};

const notesLink = { fontSize: 11, fontWeight: 500, color: INK_FAINT, cursor: "pointer", userSelect: "none" };

const NotepadCard = ({ loaded, text, version, status, empty, undoText, dispatch }) => (
  <div style={{ ...styles.card, width: 390, flex: 1, minHeight: 150, display: "flex", flexDirection: "column" }}>
    <div style={styles.gloss} />
    <div style={{ ...styles.content, flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div style={styles.title}>Notes</div>
          {loaded && undoText != null && (
            <span style={{ ...notesLink, color: INK }} onClick={() => {
              replaceNotes(undoText, dispatch);
              dispatch({ type: "NOTES_UNDO_EXPIRE" });
            }} title="Bring back the notes you just cleared">undo</span>
          )}
          {loaded && undoText == null && !empty && (
            <span style={notesLink} onClick={() => clearNotes(dispatch)} title="Clear all notes (you can undo for a few seconds)">clear</span>
          )}
        </div>
        <div style={{ ...styles.meta, color: status === "error" ? WARN_AMBER : INK_FAINT }}>
          {loaded ? NOTES_STATUS_TEXT[status] || "saves as you type" : "loading…"}
        </div>
      </div>
      <textarea
        key={`notes-${version || 0}`}
        className="dd-scroll dd-notes"
        defaultValue={text || ""}
        // Until the saved notes arrive, typing is blocked so an empty box can't overwrite them.
        readOnly={!loaded}
        placeholder="…"
        onInput={(event) => {
          if ((event.target.value === "") !== !!empty) dispatch({ type: "NOTES_EMPTY", empty: event.target.value === "" });
          saveNotes(event.target.value, dispatch);
        }}
        spellCheck={true}
        style={{
          flex: 1,
          minHeight: 0,
          resize: "none",
          border: "none",
          outline: "none",
          borderRadius: 8,
          padding: "10px 12px",
          background: TILE,
          color: INK,
          font: "inherit",
          fontSize: 13,
          lineHeight: 1.5,
        }}
      />
    </div>
  </div>
);

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

const ClockCard = ({ data, refreshing, refreshDone, onRefresh, marked }) => {
  const now = new Date();
  const source = (name) => (data && data[name] && data[name].data) || null;

  const accounts = (source("gmail") || {}).accounts || [];
  const classes = (source("piazza") || {}).classes || [];
  const soon = upcomingItems(source("canvas"), source("gradescope"), marked).filter((item) => {
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
          {/* Fills the space right of the time and centers the bubble in it. The negative
              margin extends that space over the panel's 18px padding, so the bubble is
              centered between the time and the panel's visible edge. */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center", marginRight: -18 }}>
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

// Piazza's side of the Messages panel: one tab per class.
const PiazzaBody = ({ source, selected, onSelect }) => {
  const classes = (source && source.data && source.data.classes) || [];
  // `selected` may be undefined (fresh state) or a class that's gone: fall back to the first.
  const current = classes.find((c) => c.id === selected) || classes[0];
  const posts = current ? current.posts.slice(0, PIAZZA_POSTS) : [];

  return (
    <div>
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
      <SourceWarning source={source} />
    </div>
  );
};

// ----- Messages: Gmail and Piazza in one panel, switched from the header -----

const switchStyle = (active) => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 12px",
  borderRadius: 8,
  fontSize: 14,
  fontWeight: active ? 650 : 500,
  color: active ? INK : INK_SOFT,
  background: active ? TILE_ACTIVE : "transparent",
  cursor: "pointer",
  whiteSpace: "nowrap",
});

const MessagesCard = ({ gmail, piazza, view, onView, gmailTab, onGmailTab, piazzaTab, onPiazzaTab, refreshing, onRefresh }) => {
  const showPiazza = view === "piazza"; // anything else (including missing state) = Gmail
  const accounts = (gmail && gmail.data && gmail.data.accounts) || [];
  const classes = (piazza && piazza.data && piazza.data.classes) || [];
  const gmailUnread = sum(accounts, (a) => a.unread_recent);
  const piazzaUnread = sum(classes, (c) => c.unread);
  const source = showPiazza ? piazza : gmail;

  const toggle = (
    <div style={{ display: "flex", gap: 2, background: TILE, borderRadius: 10, padding: 2, margin: "-4px 0 -4px -2px" }}>
      <div style={switchStyle(!showPiazza)} onClick={() => onView("gmail")} title="Unread emails, last 7 days">
        Gmail {gmailUnread > 0 && <span style={badgeStyle}>{badgeText(gmailUnread)}</span>}
      </div>
      <div style={switchStyle(showPiazza)} onClick={() => onView("piazza")} title="Unread Piazza posts">
        Piazza {piazzaUnread > 0 && <span style={badgeStyle}>{badgeText(piazzaUnread)}</span>}
      </div>
    </div>
  );

  return (
    <div style={{ ...styles.card, width: 390 }}>
      <div style={styles.gloss} />
      <div style={styles.content}>
        <div style={{ ...styles.header, alignItems: "center" }}>
          {toggle}
          <div style={styles.meta}>
            <span>{refreshing ? "refreshing…" : updatedAgo(source && source.updated_at)}</span>
            <span style={styles.refresh} onClick={onRefresh} title="Refresh now">↻</span>
          </div>
        </div>
        {showPiazza
          ? <PiazzaBody source={piazza} selected={piazzaTab} onSelect={onPiazzaTab} />
          : <GmailBody source={gmail} selected={gmailTab} onSelect={onGmailTab} />}
      </div>
    </div>
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
// Right column height: from its (lifted) top to the bottom of the clock panel, i.e. the
// middle column's height (calendar 0-7 PM at PX_PER_HOUR + clock panel = 745) + SIDE_LIFT.
// Update it if the calendar or clock panel change height.
const RIGHT_COLUMN_H = 765;

// ----- Left column fit: GitHub turns into a dropdown when Coursework is too full -----

const DOCK_CLEARANCE = 44; // keep the left column's bottom this far above the bottom of the desktop
const COLUMN_GAP = 16;

// Full (unfolded) height of a FoldCard, with the standard header: the card's own padding and
// border, plus the standard header's height, plus everything in its body (scrollHeight counts
// the body even while it's folded away).
const fullHeight = (column, name, standardHeaderH) => {
  const card = column.querySelector(`[data-fold-card="${name}"]`);
  const header = column.querySelector(`[data-fold-header="${name}"]`);
  const fold = column.querySelector(`[data-fold="${name}"]`);
  const inner = column.querySelector(`[data-fold-inner="${name}"]`);
  if (!card || !header || !fold || !inner) return 0;
  return card.offsetHeight - header.offsetHeight - fold.offsetHeight + standardHeaderH + inner.scrollHeight;
};

// Called after each render: would both panels, fully open, run past the Dock line?
// Only dispatches when the answer changes, so it can't loop.
const fitLeftColumn = (column, compactNow, dispatch) => {
  // A plain timer, not requestAnimationFrame: macOS can pause animation frames for a window
  // that's fully covered, which the desktop usually is.
  setTimeout(() => {
    if (!column.isConnected) return;
    const courseworkHeader = column.querySelector('[data-fold-header="coursework"]');
    if (!courseworkHeader) return;
    const standardHeaderH = courseworkHeader.offsetHeight; // GitHub's normal header is the same
    const total = fullHeight(column, "coursework", standardHeaderH) + COLUMN_GAP + fullHeight(column, "github", standardHeaderH);
    const compact = column.getBoundingClientRect().top + total > window.innerHeight - DOCK_CLEARANCE;
    if (compact !== compactNow) dispatch({ type: "SET_LEFT_COMPACT", compact });
  }, 0);
};

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
  .dd-scroll::-webkit-scrollbar { width: 4px; }
  .dd-scroll::-webkit-scrollbar-thumb { background: rgba(28, 30, 34, 0.25); border-radius: 2px; }
  .dd-scroll::-webkit-scrollbar-track { background: transparent; }
  .dd-notes::placeholder { color: rgba(28, 30, 34, 0.4); }
`;

export const render = (state, dispatch) => {
  const { data, offline, gmailTab, calendarOffset, piazzaTab } = state;
  const refreshing = isRefreshing(state);
  currentDispatch = dispatch;
  currentLoginsStarted = state.loginsStarted || {};
  const compact = !!state.leftCompact; // (both may be missing in state saved by an older version)
  const githubOpen = !!state.githubOpen;
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
      {/* Left: when Coursework is too full for both panels (leftCompact), GitHub becomes a
          dropdown header. Opening it folds Coursework up under its header, so GitHub grows
          upward into that space instead of running off the bottom of the screen. */}
      <div style={leftWall} ref={(el) => el && fitLeftColumn(el, compact, dispatch)}>
        <CourseworkCard
          canvasSource={data && data.canvas}
          gradescopeSource={data && data.gradescope}
          refreshing={refreshing}
          onRefresh={onRefresh}
          folded={compact && githubOpen}
          onUnfold={() => dispatch({ type: "TOGGLE_GITHUB" })}
          marked={state.submittedUrls}
          onMark={(url, submitted) => setSubmitted(url, submitted, dispatch)}
        />
        <GitHubCard
          source={data && data.github}
          refreshing={refreshing}
          onRefresh={onRefresh}
          width={370}
          compact={compact}
          open={githubOpen}
          onToggle={() => dispatch({ type: "TOGGLE_GITHUB" })}
        />
      </div>
      <div style={{ ...column, gap: 12 }}>
        <CalendarCard
          source={data && data.calendar}
          offset={calendarOffset}
          onOffset={(offset) => dispatch({ type: "SET_CALENDAR_OFFSET", offset })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <ClockCard data={data} refreshing={refreshing} refreshDone={refreshDone} onRefresh={onRefresh}
                   marked={state.submittedUrls} />
      </div>
      {/* Right: Gmail/Piazza in one panel, then the notepad stretching down to line up with
          the bottom of the clock panel (so it absorbs the difference when the tabs change). */}
      <div style={{ ...rightWall, height: RIGHT_COLUMN_H }}>
        <MessagesCard
          gmail={data && data.gmail}
          piazza={data && data.piazza}
          view={state.messagesView}
          onView={(view) => dispatch({ type: "SET_MESSAGES_VIEW", view })}
          gmailTab={gmailTab}
          onGmailTab={(label) => dispatch({ type: "SELECT_GMAIL_TAB", label })}
          piazzaTab={piazzaTab}
          onPiazzaTab={(id) => dispatch({ type: "SELECT_PIAZZA_TAB", id })}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
        <NotepadCard
          loaded={!!state.notesLoaded}
          text={state.notesText}
          version={state.notesVersion}
          status={state.notesStatus}
          empty={state.notesEmpty !== false} // missing (older saved state) counts as empty
          undoText={typeof state.notesUndo === "string" ? state.notesUndo : null}
          dispatch={dispatch}
        />
      </div>
    </div>
  );
};
