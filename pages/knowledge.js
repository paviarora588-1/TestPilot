(function () {
  const app = window.TestPilot;
  const { DATA, shell, pageTitle, btn, table, rows, confidence, progress, badge, stepper } = app;

  app.registerPage('knowledge', function knowledge() {
    return shell(`${pageTitle('Knowledge Base', 'Upload and index product guides, specs, Jira stories, screenshots, test cases, release notes, and known issues.', `${btn('Import Folder', "notify('Folder import simulated')")}${btn('Process Knowledge', "setPage('processing')", 'primary')}`)}
      ${stepper(1)}
      <div class="grid sidebar-layout">
        <div>
          <div class="upload" onclick="document.getElementById('knowledgeFile').click()">
            <input id="knowledgeFile" type="file" hidden onchange="notify('Knowledge file selected: '+this.files[0].name)">
            <h3>Drop or click to upload product knowledge</h3>
            <p>PDF, DOCX, XLSX, CSV, PNG, JPG, TXT, Jira exports, release notes, and known issues.</p>
            ${btn('Upload Knowledge', "document.getElementById('knowledgeFile').click();event.stopPropagation()", 'primary')}
          </div>
          <br><div class="card"><h3>Extracted Knowledge Preview</h3>${table(['Module', 'Feature', 'Business Rule', 'Confidence'], rows(DATA.extractedKnowledge).map(r => [r[0], r[1], r[2], confidence(r[3])]))}</div>
        </div>
        <div class="card">
          <h3>Processing Metrics</h3>
          ${[
            ['Documents uploaded', 128],
            ['Chunks created', 1842],
            ['Modules detected', 8],
            ['Features detected', 36],
            ['Business rules extracted', 214]
          ].map(([a, b]) => `<button class="quick" onclick="notify('${a}: ${b}')"><span class="qicon">KB</span><div><strong>${b}</strong><p>${a}</p></div></button>`).join('')}
          <div style="margin-top:14px"><strong>Knowledge readiness</strong>${progress(DATA.readiness.knowledge, 'success')}</div>
        </div>
      </div>
      <div class="card" style="margin-top:18px"><h3>Knowledge Sources</h3>${table(['Source', 'Format', 'Count', 'Status'], rows(DATA.knowledgeSources).map(r => [r[0], r[1], r[2], badge(r[3])]))}</div>`);
  });
})();
