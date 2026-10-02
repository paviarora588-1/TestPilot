(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, kpi, table, rows, badge } = app;

  app.registerPage('execution', function execution() {
    return shell(`${pageTitle('Execution Center', 'Monitor live automation, step-level progress, evidence, logs, and AI failure analysis.', `${btn('Schedule Run', "notify('Run scheduled')")}${btn('Open History', "setPage('history')", 'primary')}`)}
      <div class="grid four">${[['Total Tests', '120', 'Queued and active'], ['Passed', '94', 'Latest suite'], ['Failed', '18', 'Needs analysis'], ['Duration', '42m', 'Full suite']].map((x, i) => kpi(x[0], x[1], x[2], ['primary', 'success', 'error', 'warning'][i])).join('')}</div>
      <div class="grid sidebar-layout" style="margin-top:18px">
        <div class="card"><h3>Live Execution Table</h3>${table(['Test Case', 'Platform', 'Framework', 'Status', 'Duration', 'Evidence'], rows(DATA.executions).map(r => [r[0], badge(r[1], 'info'), r[2], badge(r[3]), r[4], r[5]]), "notify.bind(null,'Execution opened')")}</div>
        <div class="card"><h3>Step-Level Execution</h3>${DATA.executionSteps.map(r => `<button class="quick" onclick="notify('Step ${r[0]} selected')"><span class="qicon">${r[0]}</span><div><strong>${r[1]}</strong><p>${r[3]}</p></div>${badge(r[2])}</button>`).join('')}</div>
      </div>
      <div class="grid three" style="margin-top:18px">
        <div class="card"><h3>Evidence Placeholder</h3><div class="empty-state">Screenshots, SAP status bar captures, browser console exports, and desktop evidence will appear here.</div></div>
        <div class="card"><h3>Logs</h3><div class="log-panel"><code>${DATA.logs.join('\n')}</code></div></div>
        <div class="card"><h3>AI Failure Analysis</h3>${DATA.failureAnalysis.map(([a, b]) => `<button class="quick" onclick="notify('${a}')"><span class="qicon">AI</span><div><strong>${a}</strong><p>${b}</p></div></button>`).join('')}${btn('Send to Auto Heal', "setPage('heal')", 'primary')}</div>
      </div>`);
  });
})();
