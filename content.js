(() => {
  const BADGE_ID = "job-post-date-badge";

  const fetchJson = (url) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "fetchJson", url }, (res) => {
        resolve(res && res.ok ? res.data : null);
      });
    });

  // ---------- Per-site lookups: each returns a date value or null ----------

  async function ashby(u) {
    // jobs.ashbyhq.com/{org}/{jobId}
    const [org, jobId] = u.pathname.split("/").filter(Boolean);
    if (!org || !jobId) return null;
    const data = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${org}`);
    const job = data?.jobs?.find((j) => j.id === jobId);
    return job?.publishedAt || job?.publishedDate || null;
  }

  async function lever(u) {
    // jobs.lever.co/{company}/{id}[/apply]  (also jobs.eu.lever.co)
    const [company, id] = u.pathname.split("/").filter(Boolean);
    if (!company || !id) return null;
    const apiHost = u.hostname.includes(".eu.") ? "api.eu.lever.co" : "api.lever.co";
    const data = await fetchJson(`https://${apiHost}/v0/postings/${company}/${id}`);
    return data?.createdAt || null;
  }

  async function greenhouse(u) {
    // job-boards.greenhouse.io/{board}/jobs/{id}  or  boards.greenhouse.io/{board}/jobs/{id}
    const m = u.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    const board = m?.[1] || u.searchParams.get("for");
    const id = m?.[2] || u.searchParams.get("gh_jid") || u.searchParams.get("token");
    if (!board || !id) return null;
    const apiHost = u.hostname.includes(".eu.") ? "boards-api.eu.greenhouse.io" : "boards-api.greenhouse.io";
    const data = await fetchJson(`https://${apiHost}/v1/boards/${board}/jobs/${id}`);
    return data?.first_published || data?.updated_at || null;
  }

  async function workday(u) {
    // {tenant}.wd5.myworkdayjobs.com/[en-US/]{site}/job/{location}/{title}_{id}
    const m = u.pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/(job\/.+?)\/?$/);
    if (!m) return null;
    const tenant = u.hostname.split(".")[0];
    const data = await fetchJson(`${u.origin}/wday/cxs/${tenant}/${m[1]}/${m[2]}`);
    const info = data?.jobPostingInfo;
    return info?.startDate || info?.postedOn || null;
  }

  async function bamboohr(u) {
    // {company}.bamboohr.com/careers/{id}
    const m = u.pathname.match(/^\/careers\/(\d+)/);
    if (!m) return null;
    const data = await fetchJson(`${u.origin}/careers/${m[1]}/detail`);
    return data?.result?.jobOpening?.datePosted || null;
  }

  // Fallback: schema.org JobPosting embedded in the page
  function jsonLd() {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const items = [].concat(JSON.parse(s.textContent));
        for (const it of items.flatMap((x) => x["@graph"] || x)) {
          if (it?.datePosted) return it.datePosted;
        }
      } catch {}
    }
    return null;
  }

  function siteHandler(host) {
    if (host.endsWith("ashbyhq.com")) return ashby;
    if (host.endsWith("lever.co")) return lever;
    if (host.endsWith("greenhouse.io")) return greenhouse;
    if (host.endsWith("myworkdayjobs.com") || host.endsWith("myworkdaysite.com")) return workday;
    if (host.endsWith("bamboohr.com")) return bamboohr;
    return null;
  }

  // ---------- Formatting & badge ----------

  function toDate(v) {
    if (v == null) return null;
    if (typeof v === "number") return new Date(v);
    const ymd = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (ymd) return new Date(+ymd[1], ymd[2] - 1, +ymd[3]); // local date, no TZ shift
    const d = new Date(v);
    return isNaN(d) ? null : d;
  }

  function describe(v) {
    const d = toDate(v);
    if (!d) return String(v); // e.g. Workday "Posted 30+ Days Ago"
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const ago = days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
    const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    return `${date} (${ago})`;
  }

  function showBadge(text, found) {
    let el = document.getElementById(BADGE_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = BADGE_ID;
      el.title = "Click to hide";
      el.addEventListener("click", () => el.remove());
      Object.assign(el.style, {
        position: "fixed",
        top: "12px",
        right: "12px",
        zIndex: "2147483647",
        padding: "8px 12px",
        borderRadius: "8px",
        font: "600 13px/1.3 system-ui, sans-serif",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,.25)",
        cursor: "pointer",
      });
      document.documentElement.appendChild(el);
    }
    el.style.background = found ? "#1a7f37" : "#6e7781";
    el.textContent = `📅 Posted: ${text}`;
  }

  function removeBadge() {
    document.getElementById(BADGE_ID)?.remove();
  }

  // ---------- Run (and re-run on SPA navigation) ----------

  let lastUrl = null;
  let runId = 0;

  async function run() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    const myRun = ++runId;
    removeBadge();

    const handler = siteHandler(location.hostname);
    let value = null;
    try {
      value = handler ? await handler(new URL(location.href)) : null;
    } catch {}
    if (!value) value = jsonLd();
    if (myRun !== runId) return; // URL changed while we were fetching

    if (value) showBadge(describe(value), true);
    else if (looksLikeJobPage()) showBadge("not found", false);
  }

  // Only show "not found" on pages that look like a single job, not on job lists.
  function looksLikeJobPage() {
    const p = location.pathname;
    return /\/jobs?\/|\/careers\/\d+|^\/[^/]+\/[0-9a-f-]{20,}/i.test(p);
  }

  run();
  setInterval(run, 1000); // Workday/Ashby are single-page apps; catch URL changes
})();
