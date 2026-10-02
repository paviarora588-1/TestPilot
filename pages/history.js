(function () {
  const app = window.TestPilot;
  const { DATA, state, shell, pageTitle, btn, badge } = app;

  app.registerPage('history', function historyPage() {
    const filters = ['All', 'Product', 'Knowledge', 'Library', 'Mapping', 'Script', 'Execution', 'Auto-heal', 'Zephyr'];
    const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const visible = state.historyFilter === 'All' ? DATA.audit : DATA.audit.filter(r => normalize(r.join(' ')).includes(normalize(state.historyFilter)));
    return shell(`${pageTitle('History / Audit Timeline', 'Full traceability for product, knowledge, library, mapping, script, execution, healing, and Zephyr updates.', `${btn('Export History', "notify('History export simulated')")}${btn('Create Audit Report', "notify('Audit report created')", 'primary')}`)}
      <div class="history-filter tabs">${filters.map(f => `<button class="chip tab ${state.historyFilter === f ? 'active' : ''}" onclick="setHistoryFilter('${f}')">${f}</button>`).join('')}</div>
      <div class="timeline">${visible.map(([time, actor, action, entity, status, details, before, after]) => `<div class="event">
        <div class="event-grid"><strong>${time}</strong><span>${actor}</span><div><strong>${action}</strong><p>${entity} - ${details}</p></div>${badge(status)}</div>
        ${before || after ? `<div class="before-after"><code>Before: ${before || 'n/a'}</code><code>After: ${after || 'n/a'}</code></div>` : ''}
      </div>`).join('')}</div>`);
  });
})();
