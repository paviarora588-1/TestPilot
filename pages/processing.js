(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, table, badge, stepper, gateNotice } = app;

  app.registerPage('processing', function processing() {
    const p = DATA.processing;
    return shell(`${pageTitle('Knowledge Processing Result', 'Review what TestPilot Agent detected before building the object library.', `${btn('Improve Knowledge', "setPage('knowledge')")}${btn('Continue to Library', "setPage('library')", 'primary')}`)}
      ${stepper(2)}
      ${gateNotice()}
      <div class="grid three">
        <div class="card"><h3>Detected Modules</h3>${p.modules.map(x => `<button class="quick" onclick="notify('${x}')"><span class="qicon">M</span><strong>${x}</strong></button>`).join('')}</div>
        <div class="card"><h3>Detected Features</h3>${p.features.map(x => `<button class="quick" onclick="notify('${x}')"><span class="qicon">F</span><strong>${x}</strong></button>`).join('')}</div>
        <div class="card"><h3>Expected Messages</h3>${p.messages.map(x => `<button class="quick" onclick="notify('${x}')"><span class="qicon">MSG</span><strong>${x}</strong></button>`).join('')}</div>
      </div>
      <div class="grid two" style="margin-top:18px">
        <div class="card"><h3>Business Rules</h3>${p.rules.map(x => `<button class="quick" onclick="notify('Rule selected')"><span class="qicon">R</span><p>${x}</p></button>`).join('')}</div>
        <div class="card"><h3>Validations</h3>${p.validations.map(x => `<button class="quick" onclick="notify('${x}')"><span class="qicon">V</span><strong>${x}</strong></button>`).join('')}</div>
      </div>
      <div class="grid two" style="margin-top:18px">
        <div class="card"><h3>Missing Knowledge Gaps</h3>${table(['Gap', 'Detail', 'Priority'], p.gaps.map(r => [r[0], r[1], badge(r[2], r[2] === 'High' ? 'error' : r[2] === 'Medium' ? 'warning' : 'info')]))}</div>
        <div class="card"><h3>Suggestions to Improve Readiness</h3>${p.suggestions.map(x => `<button class="quick" onclick="notify('Suggestion added to backlog')"><span class="qicon">TIP</span><p>${x}</p></button>`).join('')}</div>
      </div>`);
  });
})();
