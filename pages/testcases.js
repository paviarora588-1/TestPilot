(function () {
  const app = window.TestPilot;
  const { DATA, state, shell, pageTitle, btn, table, rows, badge, progress, stepper } = app;

  app.registerPage('testcases', function testcasesPage() {
    const sources = ['Zephyr', 'Excel', 'CSV', 'Jira', 'Manual Paste'];
    return shell(`${pageTitle('Test Case Import', 'Bring in manual tests and prepare them for AI mapping against knowledge and object library context.', `${btn('Upload Excel/CSV', "document.getElementById('testFile').click()")}${btn('Start AI Mapping', "setPage('mapping')", 'primary')}<input id="testFile" type="file" hidden onchange="notify('Test case file selected: '+this.files[0].name)">`)}
      ${stepper(4)}
      <div class="select-cards">${sources.map(source => `<button class="select-card ${state.selectedImport === source ? 'active' : ''}" onclick="setImportSource('${source}')"><strong>${source}</strong><p>Import or paste tests from ${source}.</p></button>`).join('')}</div>
      <div class="card" style="margin-top:18px"><h3>Imported Test Cases</h3>${table(['Test Case ID', 'Title', 'Module', 'Feature', 'Source', 'Steps', 'Expected Result', 'Automation Readiness', 'Status'], rows(DATA.testCases).map(t => [t[0], t[1], t[2], t[3], badge(t[4], 'info'), t[5], t[6], progress(t[7], t[7] >= 85 ? 'success' : t[7] >= 75 ? 'warning' : 'error'), badge(t[8])]), "notify.bind(null,'Test case opened')")}</div>`);
  });
})();
