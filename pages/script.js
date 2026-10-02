(function () {
  const app = window.TestPilot;
  const { DATA, state, shell, pageTitle, btn, badge, confidence, esc, stepper } = app;

  app.registerPage('script', function script() {
    const tabs = Object.keys(DATA.scripts);
    return shell(`${pageTitle('Script Generator', 'Framework selection, generated code, reusable actions, test data, config, and execution command.', `${btn('Generate Script', "notify('Script generated')", 'primary')}${btn('Review with AI', "notify('TestPilot Agent review completed')")}${btn('Save to Project', "notify('Script saved to project')")}${btn('Download Script', "notify('Download simulated')")}${btn('Run Test', "setPage('execution')")}`)}
      ${stepper(6)}
      <div class="grid three">${DATA.frameworks.map(([name, desc, score]) => `<button class="card" onclick="setFramework('${name}')"><h3>${name}</h3><p>${desc}</p>${confidence(score)} ${state.selectedFramework === name ? badge('Selected', 'success') : badge('Available', 'neutral')}</button>`).join('')}</div>
      <div class="card" style="margin-top:18px">
        <div class="tabs">${tabs.map(t => `<button class="tab ${state.scriptTab === t ? 'active' : ''}" onclick="setScriptTab('${t}')">${t}</button>`).join('')}</div>
        <pre class="code">${esc(DATA.scripts[state.scriptTab] || DATA.scripts['Generated Code'])}</pre>
      </div>`);
  });
})();
