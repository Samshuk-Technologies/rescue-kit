import {
  CATEGORY_LABELS,
  SEVERITIES,
  type AuditResult,
  type CategoryScore,
  type Finding,
  type Severity,
} from '../types.js';

/**
 * Escape before interpolating anything derived from the scanned project.
 *
 * Every value in a finding — file paths, source excerpts, package names — comes from
 * untrusted input. Reports get shared, so an unescaped excerpt would be stored XSS in a
 * file people open in a browser.
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

function formatEffort(hours: number): string {
  if (hours === 0) return 'None';
  const days = Math.round((hours / 8) * 10) / 10;
  return `${hours} hrs <span class="unit">≈ ${days} days</span>`;
}

function scoreRing(score: number): string {
  const radius = 78;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - score / 100);

  return `
    <svg class="ring" viewBox="0 0 180 180" role="img" aria-label="Score ${score} out of 100">
      <circle class="ring-track" cx="90" cy="90" r="${radius}" />
      <circle class="ring-value" cx="90" cy="90" r="${radius}"
              stroke-dasharray="${circumference.toFixed(1)}"
              stroke-dashoffset="${offset.toFixed(1)}" />
      <text class="ring-score" x="90" y="88">${score}</text>
      <text class="ring-total" x="90" y="112">out of 100</text>
    </svg>`;
}

function categoryRow(category: CategoryScore): string {
  const label = esc(CATEGORY_LABELS[category.category]);

  if (!category.applicable) {
    return `
      <div class="cat cat--na">
        <span class="cat-name">${label}</span>
        <div class="cat-bar"><span style="width:0%"></span></div>
        <span class="cat-score">n/a</span>
      </div>`;
  }

  const count = category.findings.length;
  return `
      <div class="cat" data-band="${category.score >= 75 ? 'good' : category.score >= 50 ? 'warn' : 'bad'}">
        <span class="cat-name">${label}</span>
        <div class="cat-bar"><span style="width:${category.score}%"></span></div>
        <span class="cat-score">${category.score}</span>
        <span class="cat-count">${count === 0 ? 'clean' : `${count} issue${count === 1 ? '' : 's'}`}</span>
      </div>`;
}

function evidenceList(finding: Finding): string {
  const items = finding.evidence ?? [];
  if (items.length === 0) return '';

  const rows = items
    .map((item) => {
      const location = item.line ? `${item.file}:${item.line}` : item.file;
      const excerpt = item.excerpt
        ? `<code class="excerpt">${esc(item.excerpt)}</code>`
        : '';
      return `<li><span class="loc">${esc(location)}</span>${excerpt}</li>`;
    })
    .join('');

  return `<ul class="evidence">${rows}</ul>`;
}

function findingCard(finding: Finding): string {
  return `
      <article class="finding" data-severity="${finding.severity}">
        <header>
          <span class="pill pill--${finding.severity}">${SEVERITY_LABEL[finding.severity]}</span>
          <h3>${esc(finding.title)}</h3>
          <code class="rule-id">${esc(finding.ruleId)}</code>
        </header>
        <p class="detail">${esc(finding.detail)}</p>
        ${evidenceList(finding)}
        <div class="fix">
          <strong>How to fix</strong>
          <p>${esc(finding.remediation)}</p>
        </div>
      </article>`;
}

export interface HtmlOptions {
  /** Append the Samshuk call to action. On by default; `--no-cta` turns it off. */
  cta?: boolean;
}

export function renderHtml(result: AuditResult, options: HtmlOptions = {}): string {
  const showCta = options.cta ?? true;

  const stackChips = [
    result.stack.framework !== 'unknown' ? result.stack.framework : null,
    result.stack.typescript ? 'TypeScript' : null,
    result.stack.orm,
    result.stack.database,
    result.stack.authProvider,
    result.stack.paymentProvider,
    result.stack.testRunner,
    result.stack.errorTracking,
  ]
    .filter(Boolean)
    .map((s) => `<span class="chip">${esc(s)}</span>`)
    .join('');

  const severitySections = SEVERITIES.map((severity) => {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) return '';

    return `
      <section class="group">
        <h2><span class="dot dot--${severity}"></span>${SEVERITY_LABEL[severity]} <span class="group-count">${group.length}</span></h2>
        ${group.map(findingCard).join('')}
      </section>`;
  }).join('');

  const cleanState = `
      <section class="clean">
        <h2>No findings</h2>
        <p>Every applicable check passed. That is genuinely uncommon.</p>
      </section>`;

  const aiNote = result.stack.aiGenerated.likely
    ? `<p class="ai-note"><strong>This looks AI-generated.</strong> ${esc(result.stack.aiGenerated.signals.join('; '))}. Findings below are typical of prototypes that were built quickly and have not yet been hardened — that is expected, not a criticism of the approach.</p>`
    : '';

  const cta = showCta
    ? `
      <footer class="cta">
        <h2>Want these fixed?</h2>
        <p>
          Samshuk Technologies does exactly this work — taking prototypes and AI-generated
          codebases and getting them production-ready. Payments, auth, database design,
          testing and scaling.
        </p>
        <a class="cta-button" href="https://samshuk.com">Talk to us at samshuk.com</a>
      </footer>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rescue Kit report — ${esc(result.project.name)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa;
    --surface: #ffffff;
    --border: #e6e4e0;
    --text: #1a1917;
    --muted: #6b6862;
    --faint: #96928b;
    --accent: #1a1917;
    --critical: #c0362c;
    --high: #b5541c;
    --medium: #96731a;
    --low: #6b6862;
    --good: #2f7d4f;
    --warn: #b5841c;
    --bad: #c0362c;
    --radius: 10px;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16151a;
      --surface: #1e1d23;
      --border: #302e37;
      --text: #ece9e4;
      --muted: #a29e97;
      --faint: #78746d;
      --accent: #ece9e4;
      --critical: #f0736a;
      --high: #e29a5c;
      --medium: #d6bd63;
      --low: #a29e97;
      --good: #6cc48d;
      --warn: #d6bd63;
      --bad: #f0736a;
    }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 0 20px 80px;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.6 ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .wrap { max-width: 860px; margin: 0 auto; }

  /* ── Masthead ─────────────────────────────────────── */
  .masthead {
    display: flex; align-items: center; justify-content: space-between;
    padding: 28px 0 22px; border-bottom: 1px solid var(--border);
    flex-wrap: wrap; gap: 12px;
  }
  .brand { font-weight: 650; letter-spacing: -0.01em; }
  .brand span { color: var(--faint); font-weight: 400; }
  .meta { color: var(--faint); font-size: 13px; }

  /* ── Score ────────────────────────────────────────── */
  .hero {
    display: flex; gap: 36px; align-items: center;
    padding: 40px 0 32px; flex-wrap: wrap;
  }
  .ring { width: 168px; height: 168px; flex: none; }
  .ring-track { fill: none; stroke: var(--border); stroke-width: 12; }
  .ring-value {
    fill: none; stroke: var(--score-colour); stroke-width: 12; stroke-linecap: round;
    transform: rotate(-90deg); transform-origin: 90px 90px;
  }
  .ring-score {
    fill: var(--text); font-size: 46px; font-weight: 640;
    text-anchor: middle; letter-spacing: -0.02em;
  }
  .ring-total { fill: var(--faint); font-size: 13px; text-anchor: middle; }

  .hero-text { flex: 1 1 320px; min-width: 280px; }
  .grade {
    display: inline-block; font-size: 12px; font-weight: 650; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--score-colour);
    border: 1px solid currentColor; border-radius: 999px; padding: 3px 11px; margin-bottom: 14px;
  }
  .verdict { font-size: 19px; line-height: 1.5; margin: 0 0 16px; letter-spacing: -0.01em; }
  .ai-note {
    font-size: 14px; color: var(--muted); margin: 0 0 16px;
    padding: 12px 14px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    font-size: 12px; color: var(--muted); background: var(--surface);
    border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px;
  }

  /* ── Summary strip ────────────────────────────────── */
  .strip {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 1px; background: var(--border); border: 1px solid var(--border);
    border-radius: var(--radius); overflow: hidden; margin-bottom: 40px;
  }
  .stat { background: var(--surface); padding: 16px 18px; }
  .stat-value { font-size: 24px; font-weight: 640; letter-spacing: -0.02em; display: block; }
  .stat-value .unit { font-size: 13px; font-weight: 400; color: var(--faint); letter-spacing: 0; }
  .stat-label { font-size: 12px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.06em; }
  .stat[data-sev="critical"] .stat-value { color: var(--critical); }
  .stat[data-sev="high"] .stat-value { color: var(--high); }

  /* ── Categories ───────────────────────────────────── */
  h2 { font-size: 15px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 0 0 16px; }
  .cats { margin-bottom: 48px; }
  .cat {
    display: grid; grid-template-columns: 190px 1fr 34px 68px;
    align-items: center; gap: 14px; padding: 9px 0; font-size: 14px;
  }
  .cat-bar { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; }
  .cat-bar span { display: block; height: 100%; border-radius: 3px; background: var(--good); }
  .cat[data-band="warn"] .cat-bar span { background: var(--warn); }
  .cat[data-band="bad"] .cat-bar span { background: var(--bad); }
  .cat-score { font-variant-numeric: tabular-nums; text-align: right; font-weight: 600; }
  .cat-count { font-size: 12px; color: var(--faint); text-align: right; }
  .cat--na { color: var(--faint); }
  .cat--na .cat-score { font-weight: 400; }

  /* ── Findings ─────────────────────────────────────── */
  .group { margin-bottom: 40px; }
  .group h2 { display: flex; align-items: center; gap: 9px; color: var(--text); }
  .group-count {
    font-size: 12px; color: var(--faint); background: var(--surface);
    border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px;
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .dot--critical { background: var(--critical); }
  .dot--high { background: var(--high); }
  .dot--medium { background: var(--medium); }
  .dot--low { background: var(--low); }

  .finding {
    background: var(--surface); border: 1px solid var(--border);
    border-left: 3px solid var(--low); border-radius: var(--radius);
    padding: 20px 22px; margin-bottom: 12px;
  }
  .finding[data-severity="critical"] { border-left-color: var(--critical); }
  .finding[data-severity="high"] { border-left-color: var(--high); }
  .finding[data-severity="medium"] { border-left-color: var(--medium); }

  .finding header { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .finding h3 { font-size: 17px; margin: 0; font-weight: 600; letter-spacing: -0.01em; flex: 1 1 auto; }
  .pill {
    font-size: 11px; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 4px; color: #fff; flex: none;
  }
  .pill--critical { background: var(--critical); }
  .pill--high { background: var(--high); }
  .pill--medium { background: var(--medium); }
  .pill--low { background: var(--low); }
  .rule-id, code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; }
  .rule-id { font-size: 12px; color: var(--faint); }
  .detail { margin: 0 0 14px; color: var(--muted); font-size: 15px; }

  .evidence { list-style: none; margin: 0 0 14px; padding: 0; }
  .evidence li {
    padding: 8px 11px; margin-bottom: 4px; border-radius: 6px;
    background: var(--bg); border: 1px solid var(--border); font-size: 13px;
    overflow-x: auto;
  }
  .loc { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text); }
  .excerpt { display: block; margin-top: 4px; color: var(--faint); white-space: pre; font-size: 12.5px; }

  .fix { border-top: 1px solid var(--border); padding-top: 12px; }
  .fix strong {
    display: block; font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.07em; color: var(--faint); margin-bottom: 5px;
  }
  .fix p { margin: 0; font-size: 14.5px; }

  .clean { text-align: center; padding: 60px 0; }
  .clean h2 { color: var(--good); font-size: 20px; text-transform: none; letter-spacing: -0.01em; }

  /* ── CTA ──────────────────────────────────────────── */
  .cta {
    margin-top: 56px; padding: 34px; text-align: center;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  }
  .cta h2 { color: var(--text); font-size: 22px; text-transform: none; letter-spacing: -0.02em; margin-bottom: 10px; }
  .cta p { color: var(--muted); max-width: 480px; margin: 0 auto 22px; font-size: 15px; }
  .cta-button {
    display: inline-block; padding: 11px 24px; border-radius: 8px;
    background: var(--accent); color: var(--bg);
    text-decoration: none; font-weight: 600; font-size: 15px;
  }

  .colophon { margin-top: 28px; text-align: center; color: var(--faint); font-size: 12.5px; }
  .colophon a { color: inherit; }

  @media (max-width: 620px) {
    .cat { grid-template-columns: 1fr 46px; }
    .cat-bar, .cat-count { display: none; }
    .hero { gap: 24px; }
  }
</style>
</head>
<body>
<div class="wrap" style="--score-colour: var(--${result.score >= 75 ? 'good' : result.score >= 50 ? 'warn' : 'bad'})">

  <div class="masthead">
    <div class="brand">Rescue Kit <span>production-readiness report</span></div>
    <div class="meta">${esc(result.project.name)} · ${esc(result.generatedAt.slice(0, 10))}</div>
  </div>

  <div class="hero">
    ${scoreRing(result.score)}
    <div class="hero-text">
      <span class="grade">Grade ${result.grade}</span>
      <p class="verdict">${esc(result.verdict)}</p>
      ${aiNote}
      <div class="chips">${stackChips}</div>
    </div>
  </div>

  <div class="strip">
    <div class="stat" data-sev="critical">
      <span class="stat-value">${result.counts.critical}</span>
      <span class="stat-label">Critical</span>
    </div>
    <div class="stat" data-sev="high">
      <span class="stat-value">${result.counts.high}</span>
      <span class="stat-label">High</span>
    </div>
    <div class="stat">
      <span class="stat-value">${result.counts.medium}</span>
      <span class="stat-label">Medium</span>
    </div>
    <div class="stat">
      <span class="stat-value">${result.counts.low}</span>
      <span class="stat-label">Low</span>
    </div>
    <div class="stat">
      <span class="stat-value">${formatEffort(result.effortHours)}</span>
      <span class="stat-label">Est. remediation</span>
    </div>
  </div>

  <div class="cats">
    <h2>By category</h2>
    ${result.categories.map(categoryRow).join('')}
  </div>

  ${result.findings.length > 0 ? severitySections : cleanState}

  ${cta}

  <p class="colophon">
    Generated by <a href="https://github.com/Samshuk-Technologies/rescue-kit">Rescue Kit</a> ·
    ${result.project.filesScanned} files scanned ·
    ${result.rulesRun} rules run, ${result.rulesSkipped} not applicable ·
    Estimates are indicative, not a quote.
  </p>

</div>
</body>
</html>`;
}
