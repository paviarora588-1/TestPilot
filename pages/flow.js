(function () {
  const app = window.TestPilot;
  const { shell, pageTitle, btn, gateNotice } = app;

  app.registerPage('flow', function flow() {
    const steps = [
      ['setup', 'Product Setup', 'Create any generic product across SAP GUI, Web, Desktop, or Hybrid.'],
      ['knowledge', 'Knowledge Base', 'Upload product documents, stories, screenshots, tests, and issues.'],
      ['processing', 'Knowledge Processing', 'Extract modules, features, rules, validations, messages, and gaps.'],
      ['library', 'Product Library', 'Capture UI objects, SAP paths, locators, desktop controls, and actions.'],
      ['testcases', 'Test Case Import', 'Import manual tests from Zephyr, Excel, CSV, Jira, or paste.'],
      ['mapping', 'AI Mapping', 'Map manual steps to business intent, objects, actions, and confidence.'],
      ['script', 'Script Generation', 'Generate scripts only after readiness and mapping approval.'],
      ['execution', 'Execution', 'Run tests, capture evidence, logs, and step-level results.'],
      ['heal', 'Auto Heal if Failed', 'Suggest stable paths and require approval before repository update.'],
      ['reports', 'Reports + Zephyr/Jira', 'Publish reports, update cycles, attach logs, and create defects.']
    ];
    return shell(`${pageTitle('Product Flow', 'Knowledge-first automation lifecycle used by TestPilot Agent.', `${btn('Start Flow', "setPage('setup')", 'primary')}${btn('Open Settings', "setPage('settings')")}`)}
      ${gateNotice()}
      <div class="flow">${steps.map((s, i) => `<button class="flow-card" onclick="setPage('${s[0]}')"><span class="flow-num">${i + 1}</span><strong>${s[1]}</strong><p>${s[2]}</p></button>`).join('')}</div>
      <div class="card" style="margin-top:18px"><h3>AI Architecture</h3><p>TestPilot Agent is the single standard AI agent for the product. It uses product knowledge, product library, and test case context to generate reliable automation. It does not generate scripts without sufficient knowledge and library confidence.</p></div>`);
  });
})();
