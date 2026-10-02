(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, field, table, rows, badge } = app;

  app.registerPage('integration', function integration() {
    return shell(`${pageTitle('Zephyr / Jira Integration', 'Import cases, export results, attach evidence/logs, and create defects on failure.', `${btn('Test Connection', "notify('Connection test passed')")}${btn('Save Integration', "notify('Integration saved')", 'primary')}`)}
      <div class="grid sidebar-layout">
        <div class="card"><h3>Configuration</h3><div class="form-grid">
          ${field('integration', 'jiraUrl', 'Jira Base URL')}
          ${field('integration', 'projectKey', 'Project Key')}
          ${field('integration', 'token', 'Zephyr Token Placeholder')}
          ${field('integration', 'cycle', 'Cycle Name')}
          ${field('integration', 'folder', 'Folder')}
          ${field('integration', 'environment', 'Environment')}
        </div></div>
        <div class="card"><h3>Sync Options</h3>${['Import Test Cases', 'Export Execution Results', 'Attach Screenshots', 'Attach Logs', 'Create Defect on Failure'].map(x => `<button class="quick" onclick="notify('${x} toggled')"><span class="qicon">ON</span><strong>${x}</strong></button>`).join('')}</div>
      </div>
      <div class="card" style="margin-top:18px"><h3>Sample Sync History</h3>${table(['Time', 'Action', 'Details', 'Status'], rows(DATA.syncHistory).map(r => [r[0], r[1], r[2], badge(r[3])]))}</div>`);
  });
})();
