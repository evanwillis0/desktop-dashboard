"""GitHub: unread notifications, pull requests that involve you, and your recently pushed repos.

Uses the token from the GitHub CLI (`gh auth token`), so there's no separate setup:
if `gh` is logged in, this works. Read-only: it never changes anything on GitHub.

Try it from the backend/ folder:
    ../.venv/bin/python -m dashboard.sources.github
"""

import re
import shutil
import subprocess

import httpx

API = "https://api.github.com"
# launchd starts the server with a minimal PATH, so also check the usual install spots.
GH_LOCATIONS = ["/usr/local/bin/gh", "/opt/homebrew/bin/gh"]

REASON_LABELS = {
    "review_requested": "Review requested",
    "mention": "Mentioned",
    "team_mention": "Team mentioned",
    "assign": "Assigned",
    "author": "Your thread",
    "comment": "New comment",
    "ci_activity": "CI",
    "state_change": "State changed",
    "security_alert": "Security alert",
    "subscribed": "Watching",
    "manual": "Subscribed",
    "invitation": "Invitation",
}

CI_STATES = {"SUCCESS": "passing", "FAILURE": "failing", "ERROR": "failing", "PENDING": "running", "EXPECTED": "running"}

PR_FIELDS = """
fragment pr on PullRequest {
  title url number isDraft updatedAt reviewDecision
  repository { nameWithOwner }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}
"""

QUERY = PR_FIELDS + """
query {
  viewer {
    pullRequests(states: OPEN, first: 10, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...pr } }
    repositories(first: 3, ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER],
                 orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner url pushedAt
        issues(states: OPEN) { totalCount }
        pullRequests(states: OPEN) { totalCount }
        defaultBranchRef { target { ... on Commit { messageHeadline statusCheckRollup { state } } } }
      }
    }
  }
  reviewRequests: search(type: ISSUE, query: "is:open is:pr review-requested:@me archived:false", first: 10) {
    nodes { ...pr }
  }
}
"""


def get_token() -> str:
    """Ask the GitHub CLI for its token (it keeps it in the macOS Keychain)."""
    gh = shutil.which("gh") or next((p for p in GH_LOCATIONS if shutil.which(p)), None)
    if not gh:
        raise RuntimeError("GitHub CLI (gh) not found")
    result = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, timeout=10)
    if result.returncode != 0 or not result.stdout.strip():
        raise RuntimeError("GitHub CLI isn't logged in. Run: gh auth login")
    return result.stdout.strip()


def web_url(api_url: str | None, repo: str) -> str:
    """Turn an API link into the page you'd open in a browser.

    https://api.github.com/repos/o/r/pulls/12 -> https://github.com/o/r/pull/12
    """
    if not api_url:
        return f"https://github.com/notifications?query=repo%3A{repo}"
    url = api_url.replace("https://api.github.com/repos/", "https://github.com/")
    url = re.sub(r"/pulls/(\d+)$", r"/pull/\1", url)
    url = re.sub(r"/commits/(\w+)$", r"/commit/\1", url)
    url = re.sub(r"/releases/\d+$", "/releases", url)
    return url


def ci_state(rollup: dict | None) -> str | None:
    return CI_STATES.get(rollup["state"]) if rollup else None


def parse_pr(node: dict, role: str) -> dict:
    commits = node["commits"]["nodes"]
    return {
        "title": node["title"],
        "repo": node["repository"]["nameWithOwner"],
        "number": node["number"],
        "url": node["url"],
        "draft": node["isDraft"],
        "review": node["reviewDecision"],  # APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or None
        "ci": ci_state(commits[0]["commit"]["statusCheckRollup"]) if commits else None,
        "updated_at": node["updatedAt"],
        "role": role,  # "author" (yours) or "reviewer" (someone asked for your review)
    }


def parse_repo(node: dict) -> dict:
    head = (node.get("defaultBranchRef") or {}).get("target") or {}
    return {
        "name": node["nameWithOwner"],
        "url": node["url"],
        "pushed_at": node["pushedAt"],
        "last_commit": head.get("messageHeadline"),
        "ci": ci_state(head.get("statusCheckRollup")),
        "open_issues": node["issues"]["totalCount"],
        "open_prs": node["pullRequests"]["totalCount"],
    }


def parse_notification(item: dict) -> dict:
    repo = item["repository"]["full_name"]
    return {
        "title": item["subject"]["title"],
        "type": item["subject"]["type"],  # PullRequest, Issue, Release, CheckSuite, ...
        "reason": REASON_LABELS.get(item["reason"], item["reason"].replace("_", " ").capitalize()),
        "repo": repo,
        "url": web_url(item["subject"].get("url"), repo),
        "updated_at": item["updated_at"],
    }


def fetch() -> dict:
    headers = {"Authorization": f"Bearer {get_token()}", "Accept": "application/vnd.github+json"}
    with httpx.Client(base_url=API, headers=headers, timeout=20) as client:
        notifications = client.get("/notifications", params={"per_page": 20})
        notifications.raise_for_status()

        graphql = client.post("/graphql", json={"query": QUERY})
        graphql.raise_for_status()
        body = graphql.json()
        if body.get("errors"):
            raise RuntimeError(f"GitHub query failed: {body['errors'][0].get('message', 'unknown error')}")

    data = body["data"]
    review_requests = [parse_pr(n, "reviewer") for n in data["reviewRequests"]["nodes"] if n]
    mine = [parse_pr(n, "author") for n in data["viewer"]["pullRequests"]["nodes"]]
    return {
        "notifications": [parse_notification(n) for n in notifications.json()],
        "pull_requests": review_requests + mine,  # review requests first: they're waiting on you
        "repos": [parse_repo(n) for n in data["viewer"]["repositories"]["nodes"]],
    }


def main() -> None:
    data = fetch()
    print(f"Unread notifications ({len(data['notifications'])})")
    for n in data["notifications"]:
        print(f"  • [{n['reason']}] {n['repo']}: {n['title']}")
    print(f"\nPull requests ({len(data['pull_requests'])})")
    for pr in data["pull_requests"]:
        print(f"  • ({pr['role']}) {pr['repo']}#{pr['number']} {pr['title']}  ci={pr['ci']}")
    print("\nRecent repos")
    for r in data["repos"]:
        print(f"  • {r['name']}  pushed {r['pushed_at']}  issues={r['open_issues']} prs={r['open_prs']}")
        print(f"      last commit: {r['last_commit']}")


if __name__ == "__main__":
    main()
