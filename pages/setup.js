(function () {
  const app = window.TestPilot;
  const { DATA, state, shell, pageTitle, btn, field, stepper, badge } = app;

  app.registerPage('setup', function setup() {
    const types = ['SAP GUI', 'Web', 'Desktop', 'Hybrid'];
    return shell(`${pageTitle('Product Setup', 'Configure a generic product entry point and defaults before knowledge ingestion.', `${btn('Save Product', "notify('Product saved')", 'primary')}${btn('Continue to Knowledge', "setPage('knowledge')")}`)}
      ${stepper(0)}
      <div class="grid sidebar-layout">
        <div class="card">
          <h3>Product Type</h3>
          <div class="select-cards">${types.map(type => `<button class="select-card ${state.selectedProductType === type ? 'active' : ''}" onclick="state.selectedProductType='${type}';DATA.product.type='${type}';render()"><strong>${type}</strong><p>${type === 'Hybrid' ? 'Orchestrates multiple platforms in one flow.' : `Automation defaults for ${type}.`}</p></button>`).join('')}</div>
          <br><h3>Product Details</h3>
          <div class="form-grid">
            ${field('product', 'name', 'Product Name')}
            ${field('product', 'type', 'Product Type', 'select', types)}
            ${field('product', 'environment', 'Environment')}
            ${field('product', 'entry', 'SAP Logon Path / Web URL / Desktop EXE Path')}
            ${field('product', 'framework', 'Default Framework', 'select', ['SAP GUI - VBScript', 'Web - Selenium Java', 'Web - Playwright', 'BDD - Cucumber', 'Desktop Automation', 'Hybrid Runner'])}
            ${field('product', 'owner', 'Owner')}
            ${field('product', 'description', 'Description', 'textarea')}
          </div>
        </div>
        <div class="card">
          <h3>Readiness Gate</h3>
          <p>Automation will stay locked until the product has knowledge, object library coverage, and approved mapping confidence.</p>
          ${['Product configured', 'Knowledge required', 'Library required', 'Mapping approval required'].map((x, i) => `<button class="quick" onclick="notify('${x}')"><span class="qicon">${i + 1}</span><div><strong>${x}</strong><p>${i === 0 ? 'Current step complete after save.' : 'Required before script generation.'}</p></div>${badge(i === 0 ? 'Ready' : 'Required', i === 0 ? 'success' : 'warning')}</button>`).join('')}
        </div>
      </div>`);
  });
})();
