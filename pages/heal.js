(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, kpi, table, rows, badge, confidence } = app;

  app.registerPage('heal', function heal() {
    return shell(`${pageTitle('Auto Heal Center', 'Review, test, approve, reject, and apply AI-suggested locator/path fixes.', `${btn('Test Suggested Path', "notify('Suggested path tested')")}${btn('Approve Fix', "notify('Fix approved')", 'primary')}${btn('Apply to Repository', "setPage('library')")}`)}
      <div class="grid four">${[['Broken Objects', '12', 'Detected'], ['Healing Suggestions', '10', 'Available'], ['Approved Fixes', '08', 'Applied'], ['Pending Review', '04', 'Waiting']].map((x, i) => kpi(x[0], x[1], x[2], ['error', 'secondary', 'success', 'warning'][i])).join('')}</div>
      <div class="card" style="margin-top:18px"><h3>Healing Suggestions</h3>${table(['Object', 'Platform', 'Old Path', 'Suggested Path', 'Reason', 'Confidence', 'Status', 'Actions'], rows(DATA.heals).map(r => [r[0], badge(r[1], 'info'), `<code>${r[2]}</code>`, `<code>${r[3]}</code>`, r[4], confidence(r[5]), badge(r[6]), `${btn('Approve', "notify('Fix approved')", 'success')} ${btn('Reject', "notify('Fix rejected')", 'danger')}`]))}</div>
      <div class="card" style="margin-top:18px"><h3>History Entry After Heal</h3><div class="event"><div class="event-grid"><strong>11:22 AM</strong><span>QA Manager</span><span>Auto-heal approved for Role Name and repository update is ready.</span>${badge('Approved')}</div></div></div>`);
  });
})();
