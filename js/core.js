(function () {
  const app = window.TestPilot = window.TestPilot || {};
  const DATA = app.DATA;

  const pageIds = ['login', 'dashboard', 'setup', 'knowledge', 'processing', 'library', 'testcases', 'mapping', 'script', 'execution', 'heal', 'integration', 'reports', 'history', 'flow', 'settings'];

  const pageMeta = {
    login: ['Welcome', 'Learn the product. Build the library. Automate anything.'],
    dashboard: ['Dashboard', 'Product readiness, AI activity, automation status, and platform coverage.'],
    setup: ['Product Setup', 'Configure any SAP GUI, Web, Desktop, or Hybrid product.'],
    knowledge: ['Knowledge Base', 'Upload product knowledge and let TestPilot Agent understand the product.'],
    processing: ['Knowledge Processing Result', 'Review extracted modules, rules, validations, messages, and knowledge gaps.'],
    library: ['Product Library', 'Manage the generic UI and object repository used by automation.'],
    testcases: ['Test Cases', 'Import manual tests from Zephyr, Excel, CSV, Jira, or manual paste.'],
    mapping: ['AI Mapping', 'Review manual step to object/action mappings before script generation.'],
    script: ['Script Generator', 'Generate, review, save, download, and run automation scripts.'],
    execution: ['Execution Center', 'Run automation and inspect live steps, evidence, logs, and failure analysis.'],
    heal: ['Auto Heal Center', 'Review AI-suggested path fixes before updating the repository.'],
    integration: ['Zephyr / Jira', 'Sync test cases, execution results, evidence, logs, and defects.'],
    reports: ['Reports', 'Automation coverage, execution trends, failures, and library health.'],
    history: ['History / Audit', 'Trace every user and TestPilot Agent action end to end.'],
    flow: ['Product Flow', 'Visualize the knowledge-first automation lifecycle.'],
    settings: ['Settings', 'Model, agent, RAG, framework, runner, approval, retention, and security rules.']
  };

  const menu = [
    ['dashboard', 'Dashboard'], ['setup', 'Product Setup'], ['knowledge', 'Knowledge Base'],
    ['library', 'Product Library'], ['testcases', 'Test Cases'], ['mapping', 'AI Mapping'],
    ['script', 'Script Generator'], ['execution', 'Execution'], ['heal', 'Auto Heal'],
    ['integration', 'Zephyr / Jira'], ['reports', 'Reports'], ['history', 'History'],
    ['flow', 'Flow'], ['settings', 'Settings']
  ];

  const state = {
    page: pageIds.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'login',
    search: '',
    toast: '',
    selectedProductType: DATA.product.type,
    selectedImport: 'Zephyr',
    selectedObject: 0,
    selectedFramework: 'Hybrid Runner',
    scriptTab: 'Generated Code',
    historyFilter: 'All',
    integration: {
      jiraUrl: 'https://company.atlassian.net',
      projectKey: 'QA',
      token: '************',
      cycle: 'Regression Cycle',
      folder: 'Automation',
      environment: 'QA Regression'
    },
    settings: JSON.parse(JSON.stringify(DATA.settings))
  };

  const pages = {};

  function registerPage(id, renderer) {
    pages[id] = renderer;
  }

  function setPage(page) {
    state.page = page;
    state.search = '';
    if (location.hash.slice(1) !== page) location.hash = page;
    render();
  }

  function notify(message) {
    state.toast = message;
    render({ preserveFocus: true });
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => {
      state.toast = '';
      render({ preserveFocus: true });
    }, 1800);
  }

  function updateField(scope, key, value) {
    if (scope === 'product') DATA.product[key] = value;
    if (scope === 'integration') state.integration[key] = value;
    if (scope === 'settings') state.settings[key] = value;
  }

  function commitField(scope, key, value) {
    updateField(scope, key, value);
    if (scope === 'product' && key === 'type') state.selectedProductType = value;
    render({ preserveFocus: true });
  }

  function toggleSetting(key) {
    state.settings.toggles[key] = !state.settings.toggles[key];
    render();
  }

  function setSearch(value) {
    state.search = value;
    render({ preserveFocus: true });
  }

  function setScriptTab(tab) {
    state.scriptTab = tab;
    render();
  }

  function setHistoryFilter(filter) {
    state.historyFilter = filter;
    render();
  }

  function selectObject(index) {
    state.selectedObject = index;
    render();
  }

  function setImportSource(source) {
    state.selectedImport = source;
    notify(`${source} source selected`);
  }

  function setFramework(framework) {
    state.selectedFramework = framework;
    DATA.product.framework = framework;
    notify(`${framework} selected`);
  }

  function clsStatus(status) {
    const s = String(status).toLowerCase();
    if (s.includes('success') || s.includes('ready') || s.includes('passed') || s.includes('active') || s.includes('approved')) return 'success';
    if (s.includes('review') || s.includes('running') || s.includes('pending') || s.includes('needed') || s.includes('warning')) return 'warning';
    if (s.includes('failed') || s.includes('missing') || s.includes('blocked') || s.includes('error')) return 'error';
    if (s.includes('mapped') || s.includes('sync') || s.includes('queued') || s.includes('skipped')) return 'info';
    return 'neutral';
  }

  function rows(list) {
    if (!state.search) return list;
    return list.filter(row => Object.values(row).join(' ').toLowerCase().includes(state.search.toLowerCase()));
  }

  function projectRows() {
    return [[DATA.product.name, DATA.product.type, '86%', '1,240', '740', '89%', 'Today 11:24 AM', 'Active']];
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[char]));
  }

  function badge(text, tone) {
    return `<span class="badge ${tone || clsStatus(text)}">${text}</span>`;
  }

  function confidence(value) {
    const tone = value >= 90 ? 'success' : value >= 80 ? 'info' : value >= 70 ? 'warning' : 'error';
    return `<span class="confidence ${tone}">${value}%</span>`;
  }

  function progress(value, tone = 'primary') {
    return `<div class="progress-wrap"><div class="progress"><span class="${tone}" style="width:${value}%"></span></div><strong>${value}%</strong></div>`;
  }

  function pageTitle(h, p, buttons = '') {
    return `<div class="page-title"><div><h1>${h}</h1><p>${p}</p></div><div class="page-actions">${buttons}</div></div>`;
  }

  function btn(label, action, kind = 'secondary') {
    return `<button class="btn ${kind}" onclick="${action}">${label}</button>`;
  }

  function kpi(label, value, detail, tone = 'primary') {
    return `<button class="card kpi-card" onclick="notify('${label}: ${value}')"><div class="kpi-mark ${tone}">${label.slice(0, 1)}</div><div><span>${label}</span><strong>${value}</strong><small>${detail}</small></div></button>`;
  }

  function table(headers, body, rowAction = '') {
    const empty = `<tr><td colspan="${headers.length}" class="empty-cell">No matching records.</td></tr>`;
    return `<div class="table-scroll"><table class="table"><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.length ? body.map((r, i) => `<tr ${rowAction ? `onclick="${rowAction}(${i})"` : ''}>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') : empty}</tbody></table></div>`;
  }

  function field(scope, key, label, type = 'input', options = [], placeholder = '') {
    const source = scope === 'product' ? DATA.product : scope === 'integration' ? state.integration : state.settings;
    const value = source[key] || '';
    const focusKey = `${scope}-${key}`;
    const inputEvent = `oninput="updateField('${scope}','${key}',this.value)"`;
    const changeEvent = `onchange="commitField('${scope}','${key}',this.value)"`;
    if (type === 'select') return `<div class="field"><label>${label}</label><select data-focus-key="${focusKey}" ${changeEvent}>${options.map(o => `<option ${value === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    if (type === 'textarea') return `<div class="field span-2"><label>${label}</label><textarea data-focus-key="${focusKey}" placeholder="${esc(placeholder)}" ${inputEvent} onblur="commitField('${scope}','${key}',this.value)">${esc(value)}</textarea></div>`;
    return `<div class="field"><label>${label}</label><input data-focus-key="${focusKey}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${inputEvent} onblur="commitField('${scope}','${key}',this.value)"></div>`;
  }

  function shell(content) {
    const [heading, subtitle] = pageMeta[state.page] || pageMeta.dashboard;
    return `<div class="app-shell">
      <aside class="sidebar">
        <button class="brand" onclick="setPage('login')"><span class="brand-mark">TP</span><span><strong>TestPilot AI</strong><small>AI automation platform</small></span></button>
        <nav class="nav">${menu.map(([id, label]) => `<button class="${state.page === id ? 'active' : ''}" onclick="setPage('${id}')"><span>${label.slice(0, 1)}</span>${label}</button>`).join('')}</nav>
        <div class="agent-card">
          <span class="eyebrow">Standard Agent</span>
          <strong>TestPilot Agent</strong>
          <p>Knowledge, library, mapping, generation, healing, reports, and audit.</p>
          ${progress(DATA.readiness.product, 'success')}
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="top-title"><span class="eyebrow">TestPilot AI</span><h2>${heading}</h2><p>${subtitle}</p></div>
          <div class="search"><input data-focus-key="global-search" value="${esc(state.search)}" oninput="setSearch(this.value)" placeholder="Search this page..." /></div>
          <button class="top-pill" onclick="setPage('settings')">Agent: Ready</button>
          <button class="avatar" onclick="setPage('settings')"><span>QM</span><strong>QA Manager</strong></button>
        </header>
        <section class="content">${content}</section>
      </main>
      ${state.toast ? `<div class="toast">${state.toast}</div>` : ''}
    </div>`;
  }

  function stepper(active) {
    const steps = [
      ['setup', 'Product'],
      ['knowledge', 'Knowledge'],
      ['processing', 'Process'],
      ['library', 'Library'],
      ['testcases', 'Tests'],
      ['mapping', 'Mapping'],
      ['script', 'Script'],
      ['execution', 'Execution']
    ];
    return `<div class="stepper">${steps.map(([id, label], i) => `<button class="step ${i < active ? 'done' : i === active ? 'active' : ''}" onclick="setPage('${id}')"><span>${i + 1}</span>${label}</button>`).join('')}</div>`;
  }

  function readinessCards() {
    return `<div class="grid four">
      ${kpi('Product Readiness', `${DATA.readiness.product}%`, 'Knowledge-first gate', 'primary')}
      ${kpi('Knowledge Base', `${DATA.readiness.knowledge}%`, 'Ready for mapping', 'success')}
      ${kpi('Product Library', `${DATA.readiness.library}%`, '546 objects indexed', 'secondary')}
      ${kpi('AI Mapping', `${DATA.readiness.mapping}%`, 'Review required below 85%', 'warning')}
    </div>`;
  }

  function gateNotice() {
    return `<div class="notice"><strong>No Knowledge + No Library = No Reliable Automation.</strong><span>TestPilot Agent does not generate scripts until knowledge, library, and mapping confidence are sufficient and reviewed.</span></div>`;
  }

  function getFocusSnapshot() {
    const el = document.activeElement;
    if (!el || !el.dataset || !el.dataset.focusKey) return null;
    return {
      key: el.dataset.focusKey,
      start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
      end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null
    };
  }

  function restoreFocus(snapshot) {
    if (!snapshot) return;
    const el = document.querySelector(`[data-focus-key="${snapshot.key}"]`);
    if (!el) return;
    el.focus();
    if (snapshot.start !== null && typeof el.setSelectionRange === 'function') el.setSelectionRange(snapshot.start, snapshot.end);
  }

  function render(options = {}) {
    const focusSnapshot = options.preserveFocus ? getFocusSnapshot() : null;
    const renderer = pages[state.page] || pages.dashboard || pages.login;
    document.getElementById('app').innerHTML = renderer();
    restoreFocus(focusSnapshot);
  }

  function start() {
    render();
  }

  window.addEventListener('hashchange', () => {
    const next = location.hash.slice(1);
    if (pageIds.includes(next) && state.page !== next) {
      state.page = next;
      state.search = '';
      render();
    }
  });

  Object.assign(app, {
    DATA,
    state,
    pageIds,
    pageMeta,
    pages,
    registerPage,
    setPage,
    notify,
    updateField,
    commitField,
    toggleSetting,
    setSearch,
    setScriptTab,
    setHistoryFilter,
    selectObject,
    setImportSource,
    setFramework,
    clsStatus,
    rows,
    projectRows,
    esc,
    badge,
    confidence,
    progress,
    shell,
    pageTitle,
    btn,
    kpi,
    table,
    field,
    stepper,
    readinessCards,
    gateNotice,
    render,
    start
  });

  Object.assign(window, {
    DATA,
    state,
    setPage,
    notify,
    updateField,
    commitField,
    toggleSetting,
    setSearch,
    setScriptTab,
    setHistoryFilter,
    selectObject,
    setImportSource,
    setFramework,
    render
  });
})();
