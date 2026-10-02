(function () {
  const app = window.TestPilot;
  const { DATA, btn } = app;

  app.registerPage('login', function login() {
    return `<div class="landing">
      <section>
        <span class="brand-mark">TP</span>
        <h1>Learn the product. Build the library. Automate anything.</h1>
        <p>TestPilot AI is a generic AI-powered test automation platform for SAP GUI, Web, Desktop, and Hybrid products. It learns your product knowledge, builds a reusable object library, maps test steps with confidence, and generates automation only after readiness gates are met.</p>
        <div class="grid three" style="margin:26px 0">
          ${['Knowledge first', 'Library second', 'Reviewed mapping third'].map(x => `<div class="card"><h3>${x}</h3><p>Required before reliable automation generation.</p></div>`).join('')}
        </div>
        ${btn('Enter Dashboard', "setPage('dashboard')", 'primary')}
        ${btn('View Product Flow', "setPage('flow')", 'secondary')}
      </section>
      <aside class="landing-panel login-card">
        <h2>TestPilot Agent</h2>
        <p>The single standard AI agent for knowledge understanding, library creation, mapping, script generation, execution analysis, auto-healing, reporting, and history tracking.</p>
        <div class="field"><label>Email</label><input value="qa.manager@testpilot.demo"></div><br>
        <div class="field"><label>Password</label><input value="demo-password" type="password"></div>
        <div class="login-actions">
          ${btn('Sign In', "setPage('dashboard')", 'primary')}
          ${btn('SSO / SAML', "notify('SSO sign-in simulated')")}
          ${btn('Request Access', "notify('Access request submitted')")}
        </div>
        <div class="notice" style="margin-top:18px"><strong>Current Product:</strong><span>${DATA.product.name}</span></div>
      </aside>
      ${app.state.toast ? `<div class="toast">${app.state.toast}</div>` : ''}
    </div>`;
  });
})();
