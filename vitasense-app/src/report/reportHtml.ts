import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import type { DoctorReport } from '@/lib/api';

const esc = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function list(items: string[], empty = 'None recorded') {
  return items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`;
}

export function reportDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A single printable A4 page. Plain HTML so it prints the same from a phone or a browser. */
export function reportHtml(r: DoctorReport): string {
  const flagged = r.labs.filter((l) => ['high', 'low', 'abnormal'].includes(l.flag));
  const otherLabs = r.labs.filter((l) => !['high', 'low', 'abnormal'].includes(l.flag));
  return `<!doctype html><html><head><meta charset="utf-8"><title>VitaSense report - ${esc(r.patient.name)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; color: #0E1B2C; font-size: 11.5px; line-height: 1.45; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #15305A; padding-bottom: 8px; margin-bottom: 10px; }
  h1 { font-size: 18px; margin: 0; color: #15305A; }
  h2 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #15305A; margin: 12px 0 4px; }
  .muted { color: #6B7A90; }
  .reason { background: #F1F5FB; border-left: 3px solid #15305A; padding: 8px 10px; font-size: 12.5px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 3px 6px 3px 0; border-bottom: 1px solid #E2E7EF; vertical-align: top; }
  th { font-weight: 600; color: #4E5D73; font-size: 10.5px; }
  .flag { font-weight: 700; color: #C7343A; text-transform: uppercase; font-size: 10px; }
  ul { margin: 2px 0 0 16px; padding: 0; }
  li { margin: 1px 0; }
  .allergy { color: #C7343A; font-weight: 600; }
  footer { margin-top: 14px; padding-top: 6px; border-top: 1px solid #E2E7EF; font-size: 9.5px; color: #6B7A90; }
</style></head><body>
<header>
  <div><h1>Patient summary for ${esc(r.specialty.toLowerCase())} visit</h1>
  <div><strong>${esc(r.patient.name)}</strong>${r.patient.life_phase ? ` · ${esc(r.patient.life_phase)}` : ''}${r.patient.lifestyle ? ` · ${esc(r.patient.lifestyle)}` : ''}</div></div>
  <div class="muted" style="text-align:right">VitaSense<br>${esc(reportDate(r.generated_at))}</div>
</header>
<h2>Reason for visit</h2>
<div class="reason">${esc(r.reason_for_visit)}</div>
<div class="grid">
  <div>
    <h2>Symptom timeline</h2>
    ${r.symptom_timeline.length ? `<table>${r.symptom_timeline.map((t) => `<tr><td style="width:32%"><strong>${esc(t.when)}</strong></td><td>${esc(t.detail)}</td></tr>`).join('')}</table>` : '<p class="muted">Not reported</p>'}
    <h2>Relevant from tracked data</h2>
    ${list(r.relevant_context, 'Nothing notable')}
    <h2>Allergies</h2>
    ${r.history.allergies.length ? `<p class="allergy">${r.history.allergies.map(esc).join(', ')}</p>` : '<p class="muted">None recorded</p>'}
    <h2>Conditions &amp; history</h2>
    ${list([...r.history.conditions, ...r.history.past_history])}
    ${r.history.recurring_patterns.length ? `<h2>Recurring patterns</h2>${list(r.history.recurring_patterns)}` : ''}
  </div>
  <div>
    <h2>Lifestyle, last ${30} days</h2>
    <table><tr><th>Measure</th><th>Latest</th><th>30-day avg</th></tr>
    ${r.lifestyle_30d.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.latest)}</td><td>${esc(m.average_30d)}</td></tr>`).join('')}</table>
    ${r.patterns_30d.length ? list(r.patterns_30d.map((p) => p.title)) : ''}
    <h2>Current medicines (prescribed)</h2>
    ${r.medications.length ? `<table>${r.medications.map((m) => `<tr><td><strong>${esc(m.name)}</strong> ${esc(m.strength ?? '')}</td><td>${esc(m.schedule)}</td><td class="muted">since ${esc(m.since ?? '')}</td></tr>`).join('')}</table>` : '<p class="muted">None</p>'}
    <h2>Recent lab results</h2>
    ${r.labs.length ? `<table><tr><th>Test</th><th>Result</th><th>Range</th><th>Date</th></tr>${[...flagged, ...otherLabs].map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.value)} ${esc(l.unit ?? '')} ${['high', 'low', 'abnormal'].includes(l.flag) ? `<span class="flag">${esc(l.flag)}</span>` : ''}</td><td>${esc(l.range ?? '')}</td><td>${esc(l.date ?? '')}</td></tr>`).join('')}</table>` : '<p class="muted">No reports added</p>'}
    ${r.local_alerts.length ? `<h2>Going around nearby</h2>${list(r.local_alerts.map((a) => `${a.title}: ${a.detail}`))}` : ''}
  </div>
</div>
<h2>Questions the patient wants to ask</h2>
${list(r.questions_for_doctor)}
<footer>${esc(r.disclaimer)}</footer>
</body></html>`;
}

/** Print (or save as PDF) on web; share a PDF on phones. */
export async function printReport(report: DoctorReport): Promise<void> {
  const html = reportHtml(report);
  if (Platform.OS === 'web') {
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.width = '0';
    frame.style.height = '0';
    frame.style.border = '0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share report with your doctor', UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}
