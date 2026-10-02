(function () {
  const app = window.TestPilot;
  const { DATA, state, shell, pageTitle, btn, table, rows, badge, confidence, stepper, progress } = app;

  app.registerPage('library', function library() {
    const detail = DATA.objects[state.selectedObject] || DATA.objects[0];
    return shell(`${pageTitle('Product Library / Object Repository', 'Capture and govern reusable objects, locators, SAP paths, desktop controls, and supported actions.', `${btn('Import Repository', "notify('Repository import simulated')")}${btn('Validate Library', "notify('Library validation complete')")}${btn('Continue to Test Cases', "setPage('testcases')", 'primary')}`)}
      ${stepper(3)}
      <div class="grid four">
        ${[['Knowledge Base', DATA.readiness.knowledge, 'success'], ['Product Library', DATA.readiness.library, 'primary'], ['Object Validation', 78, 'warning'], ['Automation Ready', DATA.readiness.product, 'secondary']].map(([a, b, tone]) => `<div class="card"><h3>${a}</h3>${progress(b, tone)}${badge(b >= 85 ? 'Ready' : 'Review', b >= 85 ? 'success' : 'warning')}</div>`).join('')}
      </div>
      <div class="grid sidebar-layout" style="margin-top:18px">
        <div class="card"><h3>Generic Object Repository</h3>${table(['Object Name', 'Platform', 'Product', 'Module', 'Feature', 'Screen', 'Object Type', 'Technical Path / Locator', 'Supported Actions', 'Status', 'Confidence'], rows(DATA.objects).map((o) => [o.name, badge(o.platform, 'info'), o.product, o.module, o.feature, o.screen, o.type, `<code>${o.path}</code>`, o.actions.join(', '), badge(o.status), confidence(o.confidence)]), 'selectObject')}</div>
        <div class="card">
          <h3>Object Detail</h3>
          <p><strong>${detail.name}</strong><br>${detail.module} / ${detail.feature}</p>
          ${badge(detail.platform, 'info')} ${badge(detail.status)}
          <p><strong>Business aliases:</strong><br>${detail.aliases.join(', ')}</p>
          <p><strong>Technical path:</strong><br><code>${detail.path}</code></p>
          <p><strong>Supported actions:</strong><br>${detail.actions.map(x => badge(x, 'neutral')).join(' ')}</p>
          <p><strong>Last verified:</strong> ${detail.verified}</p>
          <p><strong>Confidence:</strong> ${confidence(detail.confidence)}</p>
          <h3>Path Change History</h3>
          ${DATA.pathHistory.map(([t, object, before, after, status]) => `<button class="quick" onclick="notify('${object} path history')"><span class="qicon">H</span><div><strong>${object}</strong><p>${t}<br>${before} -> ${after}</p></div>${badge(status)}</button>`).join('')}
        </div>
      </div>`);
  });
})();
