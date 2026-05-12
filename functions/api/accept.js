const RECIPIENTS = ['contact@skyfynd.io', 'carlos@skyfynd.io'];
const FROM = 'Skyfynd Quote <quotes@skyfynd.io>';
const REPLY_TO = 'contact@skyfynd.io';

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY) {
    return json({ error: 'Email service not configured (RESEND_API_KEY missing)' }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const { kind, quoteId, totals, setup = [], monthly = [], usage = [] } = payload;
  if (!quoteId || !totals) {
    return json({ error: 'Missing required fields' }, 400);
  }

  const isAccept = kind === 'accept';
  const subjectTag = isAccept ? 'ACCEPTED' : 'CHANGES REQUESTED';
  const subject = `[${subjectTag}] Skyfynd Quote #${quoteId}`;

  const text = buildTextBody({ isAccept, quoteId, totals, setup, monthly, usage });
  const html = buildHtmlBody({ isAccept, quoteId, totals, setup, monthly, usage });

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: RECIPIENTS,
      reply_to: REPLY_TO,
      subject,
      text,
      html,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    return json({ error: 'Email send failed', detail }, 502);
  }

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fmt(n) {
  return '$' + Number(n || 0).toLocaleString('en-US');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildTextBody({ isAccept, quoteId, totals, setup, monthly, usage }) {
  const lines = [];
  lines.push(isAccept
    ? `Aline has ACCEPTED Skyfynd Quote #${quoteId}.`
    : `Aline is requesting CHANGES to Skyfynd Quote #${quoteId}.`);
  lines.push('');

  if (setup.length) {
    lines.push('ONE-TIME SETUP');
    setup.forEach(i => lines.push(`  - ${i.label} — ${fmt(i.price)}`));
    lines.push(`  Setup total: ${fmt(totals.setup)}`);
    lines.push('');
  }

  if (monthly.length) {
    lines.push('MONTHLY RECURRING');
    monthly.forEach(i => lines.push(`  - ${i.label} — ${i.price === 0 ? '$0' : fmt(i.price) + '/mo'}`));
    lines.push(`  Monthly total: ${fmt(totals.monthly)}/mo`);
    lines.push('');
  }

  if (usage.length) {
    lines.push('PAY-PER-USE (only billed if used)');
    usage.forEach(i => lines.push(`  - ${i.label} — ${i.detail}`));
    lines.push('');
  }

  if (totals.savings > 0) {
    lines.push(`Total savings vs. regular rates: ${fmt(totals.savings)}`);
    lines.push('');
  }

  lines.push('--');
  lines.push(isAccept
    ? 'Next step: send Aline the deposit payment link.'
    : 'Aline wants to discuss adjustments before accepting. Reach out to confirm.');
  lines.push('');
  lines.push('Generated automatically from the Skyfynd interactive quote page.');
  return lines.join('\n');
}

function buildHtmlBody({ isAccept, quoteId, totals, setup, monthly, usage }) {
  const badge = isAccept
    ? '<span style="background:#10b981;color:white;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Accepted</span>'
    : '<span style="background:#f59e0b;color:white;padding:5px 12px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Changes requested</span>';

  const sectionTable = (title, items, renderRow) => items.length
    ? `<h3 style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;margin:24px 0 8px;font-weight:600;">${title}</h3>
       <table style="width:100%;border-collapse:collapse;font-size:14px;">${items.map(renderRow).join('')}</table>`
    : '';

  const summaryRow = (label, value) =>
    `<tr><td style="padding:10px 0 0;border-top:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${label}</td>
         <td style="padding:10px 0 0;border-top:1px solid #e5e7eb;text-align:right;font-weight:700;font-size:14px;">${value}</td></tr>`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:0 auto;padding:32px;background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
    <div style="margin-bottom:18px;">${badge}</div>
    <h1 style="font-family:Georgia,serif;font-size:22px;margin:0 0 6px;letter-spacing:-0.01em;">Skyfynd Quote #${escapeHtml(quoteId)}</h1>
    <p style="color:#6b7280;font-size:14px;margin:0 0 24px;line-height:1.5;">${isAccept
      ? 'Aline has accepted the quote. <strong>Next step:</strong> send her the deposit payment link.'
      : 'Aline wants to discuss adjustments before accepting. Reach out to confirm the final scope.'}</p>

    ${sectionTable('One-time setup', setup, i =>
      `<tr><td style="padding:7px 0;color:#374151;">${escapeHtml(i.label)}</td>
           <td style="padding:7px 0;text-align:right;font-weight:600;">${fmt(i.price)}</td></tr>`
    )}
    ${setup.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;">${summaryRow('Setup total', fmt(totals.setup))}</table>` : ''}

    ${sectionTable('Monthly recurring', monthly, i =>
      `<tr><td style="padding:7px 0;color:#374151;">${escapeHtml(i.label)}</td>
           <td style="padding:7px 0;text-align:right;font-weight:600;">${i.price === 0 ? '$0' : fmt(i.price) + '/mo'}</td></tr>`
    )}
    ${monthly.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px;">${summaryRow('Monthly total', fmt(totals.monthly) + '/mo')}</table>` : ''}

    ${sectionTable('Pay-per-use', usage, i =>
      `<tr><td style="padding:7px 0;color:#374151;">${escapeHtml(i.label)}</td>
           <td style="padding:7px 0;text-align:right;color:#6b7280;">${escapeHtml(i.detail)}</td></tr>`
    )}

    ${totals.savings > 0 ? `<div style="margin-top:24px;padding:14px 18px;background:#ecfdf5;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
      <span style="color:#065f46;font-weight:600;font-size:13px;">Total savings vs. regular rates</span>
      <strong style="color:#065f46;font-size:16px;">${fmt(totals.savings)}</strong>
    </div>` : ''}

    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 16px;">
    <p style="color:#9ca3af;font-size:11px;margin:0;line-height:1.5;">Generated automatically from the Skyfynd interactive quote page.</p>
  </div>
</body></html>`;
}
