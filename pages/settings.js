(function () {
  const app = window.TestPilot;
  const { state, shell, pageTitle, btn, field, badge } = app;

  app.registerPage('settings', function settings() {
    const toggles = {
      requireScriptApproval: 'Require approval before script generation',
      requireHealApproval: 'Require approval before auto-heal update',
      allowAutoRun: 'Allow auto-run after script generation',
      storeEvidence: 'Store execution evidence',
      enableHybridRunner: 'Enable hybrid runner',
      enableDesktopAutomation: 'Enable desktop automation'
    };
    return shell(`${pageTitle('Settings', 'Configure model, agent, RAG, framework defaults, runners, approvals, retention, integrations, and security.', btn('Save Settings', "notify('Settings saved')", 'primary'))}
      <div class="grid two">
        <div class="card"><h3>AI Model Settings</h3><div class="form-grid">${field('settings', 'model', 'Model', 'select', ['GPT-4.1 Enterprise', 'GPT-4.1 Mini', 'Private Model Endpoint'])}${field('settings', 'vectorDb', 'RAG / Vector DB', 'select', ['Managed Vector Index', 'Azure AI Search', 'Pinecone', 'Postgres pgvector'])}</div></div>
        <div class="card"><h3>Runner Settings</h3><div class="form-grid">${field('settings', 'runner', 'Runner Pool', 'select', ['Hybrid Runner Pool', 'SAP GUI Runner', 'Selenium Grid', 'Playwright Workers', 'Desktop Runner'])}${field('settings', 'retention', 'History Retention', 'select', ['90 days', '180 days', '365 days', 'Forever'])}</div></div>
      </div>
      <div class="grid two" style="margin-top:18px">
        <div class="card"><h3>Agent Settings</h3><p>TestPilot Agent handles product knowledge understanding, library creation, test case understanding, step mapping, framework selection, script generation, script review, execution analysis, failure analysis, auto-healing, reporting, and audit tracking.</p>${badge('Single standard agent', 'primary')}</div>
        <div class="card"><h3>Approval Rules</h3>${Object.entries(toggles).map(([key, label]) => `<label class="quick"><input type="checkbox" ${state.settings.toggles[key] ? 'checked' : ''} onchange="toggleSetting('${key}')"><div><strong>${label}</strong><p>${state.settings.toggles[key] ? 'Enabled' : 'Disabled'}</p></div></label>`).join('')}</div>
      </div>
      <div class="grid three" style="margin-top:18px">
        ${['Framework Defaults', 'Zephyr/Jira Settings', 'Security Settings'].map(x => `<button class="card" onclick="notify('${x} opened')"><h3>${x}</h3><p>Enterprise-ready placeholder for backend connection.</p>${badge('Configured', 'success')}</button>`).join('')}
      </div>`);
  });
})();
