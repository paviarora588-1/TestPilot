(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, kpi, table, rows, projectRows, progress, badge, readinessCards } = app;

  app.registerPage('dashboard', function dashboard() {
    return shell(`${pageTitle('Automation Command Center', 'One dashboard for product readiness, knowledge, library health, mapping confidence, and execution status.', `${btn('Create Product', "setPage('setup')", 'primary')}${btn('Open Flow', "setPage('flow')")}`)}
      ${readinessCards()}
      <div class="grid four" style="margin-top:18px">${DATA.stats.map(([label, value, detail], i) => kpi(label, value, detail, ['primary', 'success', 'secondary', 'warning'][i % 4])).join('')}</div>
      <div class="grid three" style="margin-top:18px">
        <div class="card"><h3>Product Readiness Score</h3><div class="chart-row"><div class="donut"><strong>${DATA.readiness.product}%</strong></div><div class="legend">
          ${[['Knowledge Base', DATA.readiness.knowledge], ['Product Library', DATA.readiness.library], ['AI Mapping', DATA.readiness.mapping]].map(([a, b]) => `<button class="legend-row" onclick="notify('${a}: ${b}%')"><span><span class="legend-dot"></span>${a}</span><strong>${b}%</strong></button>`).join('')}
        </div></div></div>
        <div class="card"><h3>Platform Coverage</h3>${DATA.platformCoverage.map(([name, value]) => `<button class="quick" onclick="notify('${name} coverage ${value}%')"><span class="qicon">${name[0]}</span><div><strong>${name}</strong>${progress(value)}</div></button>`).join('')}</div>
        <div class="card"><h3>Automation Status</h3>${DATA.automationStatus.map(([name, value, tone]) => `<button class="quick" onclick="notify('${name}: ${value}')"><span class="qicon">${name[0]}</span><div><strong>${name}</strong><p>${value} test cases</p></div>${badge(name, tone)}</button>`).join('')}</div>
      </div>
      <div class="grid sidebar-layout" style="margin-top:18px">
        <div class="card"><h3>Products Overview</h3>${table(['Product', 'Type', 'Readiness', 'Test Cases', 'Automated', 'Success Rate', 'Last Activity', 'Status'], rows(projectRows()).map(p => [p[0], badge(p[1], 'info'), progress(86), p[3], p[4], p[5], p[6], badge(p[7])]), "setPage.bind(null,'setup')")}</div>
        <div class="card"><h3>Recent AI Activity</h3>${DATA.activity.map(([time, actor, action, details, status]) => `<button class="quick" onclick="setPage('history')"><span class="qicon">${actor === 'User' ? 'U' : 'AI'}</span><div><strong>${action}</strong><p>${time} - ${actor}<br>${details}</p></div>${badge(status)}</button>`).join('')}</div>
      </div>`);
  });
})();
