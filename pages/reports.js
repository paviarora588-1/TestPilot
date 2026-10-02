(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, table, progress, badge } = app;

  app.registerPage('reports', function reports() {
    return shell(`${pageTitle('Reports', 'Coverage, trends, framework usage, failure categories, auto-heal success, and library health.', `${btn('Export PDF', "notify('PDF export simulated')")}${btn('Export Excel', "notify('Excel export simulated')", 'primary')}`)}
      <div class="grid three">${DATA.reportCards.map(([name, value, tone]) => `<button class="card" onclick="notify('${name} opened')"><h3>${name}</h3><div class="chart-row"><div class="donut"><strong>${value}%</strong></div><div style="flex:1">${progress(value, tone)}${badge(value >= 75 ? 'Healthy' : value >= 50 ? 'Watch' : 'Risk', value >= 75 ? 'success' : value >= 50 ? 'warning' : 'error')}</div></div></button>`).join('')}</div>
      <div class="card" style="margin-top:18px"><h3>Module-wise Coverage</h3>${table(['Module', 'Test Cases', 'Automated', 'Passed', 'Failed', 'Coverage'], DATA.moduleCoverage.map(r => [r[0], r[1], r[2], r[3], r[4], r[5]]))}</div>`);
  });
})();
