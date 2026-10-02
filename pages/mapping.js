(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, badge, confidence, progress, stepper, gateNotice } = app;

  app.registerPage('mapping', function mapping() {
    const s = DATA.mappingSummary;
    const warning = s.knowledgeReady && s.libraryReady ? '' : `<div class="notice"><strong>Readiness warning:</strong><span>Knowledge or library is missing. Script generation is blocked.</span></div>`;
    return shell(`${pageTitle('AI Automation Mapping Review', 'Manual Step -> AI Understanding -> Mapped Object -> Automation Action -> Confidence -> Status.', `${btn('Regenerate Mapping', "notify('Mapping regenerated')")}${btn('Edit Mapping', "notify('Mapping edit mode opened')")}${btn('Approve Mapping', "notify('Mapping approved')", 'primary')}${btn('Send to Script Generator', "setPage('script')")}`)}
      ${stepper(5)}
      ${warning || gateNotice()}
      <div class="grid four">
        <div class="card"><h3>Test Case</h3><strong>${s.testCase}</strong><p>${s.title}</p></div>
        <div class="card"><h3>Overall Confidence</h3>${progress(s.confidence, 'success')}</div>
        <div class="card"><h3>Mapped Steps</h3><strong style="font-size:32px">${s.mapped}</strong>${badge('Mapped', 'success')}</div>
        <div class="card"><h3>Unmapped Steps</h3><strong style="font-size:32px">${s.unmapped}</strong>${badge('Needs Context', 'warning')}</div>
      </div>
      <div class="card" style="margin-top:18px">
        <h3>Step Mapping Review</h3>
        <div class="mapping-grid">
          <div class="mapping-row mapping-head"><div class="mapping-cell">Manual Step</div><div class="mapping-cell">AI Understanding</div><div class="mapping-cell">Mapped Object</div><div class="mapping-cell">Action</div><div class="mapping-cell">Confidence</div><div class="mapping-cell">Status</div></div>
          ${DATA.mappedSteps.map(r => `<div class="mapping-row"><div class="mapping-cell">${r[0]}</div><div class="mapping-cell">${r[1]}</div><div class="mapping-cell">${r[2]}</div><div class="mapping-cell"><code>${r[3]}</code></div><div class="mapping-cell">${confidence(r[4])}</div><div class="mapping-cell">${badge(r[5])}</div></div>`).join('')}
        </div>
      </div>`);
  });
})();
