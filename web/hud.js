// Orion — HUD du SOC (couche data déclarative au-dessus du cosmos).
// Vues : Cosmos · Matrice ATT&CK · Incidents. Feed live, triage, analyse, toasts.
// Lit le store Orion ; ne fait ni rendu 3D ni réseau.

const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];
const SEV_LABEL = { info: 'INFO', low: 'FAIBLE', medium: 'MOYEN', high: 'ÉLEVÉ', critical: 'CRITIQUE' };
const INC_STATUS = { open: 'OUVERT', ack: 'PRIS EN CHARGE', resolved: 'RÉSOLU', false_positive: 'FAUX POSITIF' };

// Matrice MITRE ATT&CK (sous-ensemble couvrant la kill chain simulée)
const ATTACK = [
  ['Reconnaissance',      [['T1595', 'Active Scanning'], ['T1592', 'Host Info'], ['T1589', 'Identity Info']]],
  ['Initial Access',      [['T1190', 'Exploit Public App'], ['T1566', 'Phishing'], ['T1133', 'Ext. Remote Svc']]],
  ['Execution',           [['T1203', 'Exploit Client'], ['T1059', 'Cmd & Script'], ['T1053', 'Scheduled Task']]],
  ['Persistence',         [['T1543', 'Create Service'], ['T1098', 'Account Manip'], ['T1136', 'Create Account']]],
  ['Privilege Esc.',      [['T1068', 'Exploit PrivEsc'], ['T1078', 'Valid Accounts'], ['T1055', 'Process Inject']]],
  ['Defense Evasion',     [['T1070', 'Indicator Removal'], ['T1027', 'Obfuscation'], ['T1562', 'Impair Defenses']]],
  ['Credential Access',   [['T1110', 'Brute Force'], ['T1003', 'OS Cred Dump'], ['T1555', 'Cred Stores']]],
  ['Lateral Movement',    [['T1021', 'Remote Services'], ['T1080', 'Taint Content'], ['T1570', 'Lat. Transfer']]],
  ['Exfiltration',        [['T1041', 'Over C2'], ['T1048', 'Alt Protocol'], ['T1567', 'Web Service']]],
  ['Impact',              [['T1486', 'Data Encrypted'], ['T1485', 'Data Destruction'], ['T1490', 'Inhibit Recovery']]],
];
const ORDER_TACTICS = ['Reconnaissance', 'Initial Access', 'Execution', 'Persistence',
  'Privilege Escalation', 'Defense Evasion', 'Credential Access', 'Lateral Movement', 'Exfiltration', 'Impact'];

export class Hud {
  constructor(store, renderer) {
    this.store = store;
    this.renderer = renderer;
    this.filter = new Set(SEV_ORDER);
    this.view = 'cosmos';
    this.mxCount = {};
    this.$ = (id) => document.getElementById(id);

    this._buildFilters();
    this._buildMatrix();
    this._buildNav();
    this._buildAnalystToggle();
    this._buildModal();
    this._buildPalette();
    this._startClock();
    this.renderer.onPick = (id) => this.showBody(id);
    this.renderer.onSupernova = () => this._flash();
  }

  setConnected(on) {
    const el = this.$('conn');
    el.textContent = on ? '● OPÉRATIONNEL' : '○ HORS LIGNE';
    el.className = on ? 'on' : 'off';
  }

  onSnapshot() {
    this.refreshKpis();
    this._renderFeed();
    this._renderAnalytics();
  }

  onEvent(ev) {
    this.refreshKpis();
    this._prependFeedItem(ev);
    this._markMatrix(ev);
    this._renderAnalytics();
    if (ev.incident) {
      this._renderKillChain(this.store.incidents.get(ev.incident));
      if (this.view === 'incidents') this._renderIncidents();
    }
    if (ev.severity === 'high' || ev.severity === 'critical') this._toast(ev);
  }

  onBodyStatus() { this.refreshKpis(); this._renderAnalytics(); }

  onBodyAdd() { this.refreshKpis(); this._renderAnalytics(); }

  // Backfill historique : peuple le feed, la matrice et l'analyse sans animer le cosmos.
  onHistory(events) {
    this.refreshKpis();
    this._renderFeed();
    this._renderAnalytics();
    for (const ev of events) if (ev.mitre) this._markMatrix(ev);
    const incs = this.store.incidentList();
    if (incs[0]) this._renderKillChain(incs[0]);
    if (this.view === 'incidents') this._renderIncidents();
  }

  refreshKpis() {
    const k = this.store.kpis();
    this.$('kpi-supervised').textContent = k.supervised;
    this.$('kpi-threats').textContent = k.threats;
    this.$('kpi-compromised').textContent = k.compromised;
    this.$('kpi-incidents').textContent = k.incidents;
    this.$('kpi-rate').textContent = k.eventsPerMin;
    this.$('kpi-compromised').parentElement.classList.toggle('alarm', k.compromised > 0);
  }

  // ---------- Navigation entre vues ----------
  _buildNav() {
    for (const btn of document.querySelectorAll('#views button')) {
      btn.addEventListener('click', () => this._switchView(btn.dataset.view));
    }
  }

  _switchView(v) {
    this.view = v;
    for (const btn of document.querySelectorAll('#views button')) btn.classList.toggle('active', btn.dataset.view === v);
    this.$('view-matrix').classList.toggle('show', v === 'matrix');
    this.$('view-incidents').classList.toggle('show', v === 'incidents');
    if (v === 'incidents') this._renderIncidents();
  }

  // ---------- Feed ----------
  _renderFeed() {
    const feed = this.$('feed'); feed.innerHTML = '';
    for (const ev of this.store.events) feed.appendChild(this._feedItem(ev));
  }

  _prependFeedItem(ev) {
    const feed = this.$('feed');
    feed.prepend(this._feedItem(ev));
    while (feed.children.length > 120) feed.lastChild.remove();
  }

  _feedItem(ev) {
    const li = document.createElement('div');
    li.className = `alert sev-${ev.severity}`;
    li.style.display = this.filter.has(ev.severity) ? '' : 'none';
    li.dataset.sev = ev.severity;
    li.innerHTML = `
      <div class="alert-top">
        <span class="badge">${SEV_LABEL[ev.severity]}</span>
        <span class="time">${new Date(ev.ts).toLocaleTimeString('fr-FR')}</span>
        ${ev.mitre ? `<span class="mitre">${ev.mitre}</span>` : ''}
        ${ev.intel?.match ? '<span class="ioc">⚠ IOC</span>' : ''}
      </div>
      <div class="alert-title"></div>
      <div class="alert-meta">${ev.geo ? ev.geo.flag + ' ' : ''}${shortId(ev.src)} → <b>${shortId(ev.dst)}</b></div>`;
    li.querySelector('.alert-title').textContent = ev.title;
    li.addEventListener('click', () => this.showEvent(ev));
    return li;
  }

  _buildFilters() {
    const box = this.$('filters');
    for (const sev of SEV_ORDER) {
      const chip = document.createElement('button');
      chip.className = `chip sev-${sev} active`;
      chip.textContent = SEV_LABEL[sev];
      chip.addEventListener('click', () => {
        if (this.filter.has(sev)) { this.filter.delete(sev); chip.classList.remove('active'); }
        else { this.filter.add(sev); chip.classList.add('active'); }
        for (const li of this.$('feed').children) li.style.display = this.filter.has(li.dataset.sev) ? '' : 'none';
      });
      box.appendChild(chip);
    }
  }

  _buildAnalystToggle() {
    const btn = this.$('analyst');
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('active', on);
      this.renderer.setAnalyst(on);
    });
  }

  _startClock() {
    const tick = () => {
      const d = new Date();
      this.$('clock').textContent = d.toISOString().slice(11, 19) + ' UTC';
    };
    tick(); setInterval(tick, 1000);
  }

  // ---------- Triage / détail ----------
  _rtab(tab) {
    for (const b of document.querySelectorAll('#rtabs button')) b.classList.toggle('active', b.dataset.rtab === tab);
    this.$('rt-analyse').hidden = tab !== 'analyse';
    this.$('rt-detail').hidden = tab !== 'detail';
  }

  showEvent(ev) {
    const b = this.store.bodies.get(ev.dst);
    this._openDetail(`Événement · ${SEV_LABEL[ev.severity]}`, `
      ${row('Titre', escapeHtml(ev.title))}
      ${row('Sévérité', `<span class="st st-${ev.severity}">${SEV_LABEL[ev.severity]}</span>`)}
      ${row('Type', ev.type)}
      ${row('Tactique ATT&CK', ev.stage ? `${ev.stage} (${ev.mitre})` : (ev.mitre || '—'))}
      ${row('Source', shortId(ev.src))}
      ${row('Cible', b ? `${b.label} · ${shortId(ev.dst)}` : shortId(ev.dst))}
      ${row('Incident', ev.incident || '—')}
      ${row('Horodatage', new Date(ev.ts).toLocaleString('fr-FR'))}
      ${ev.geo ? `<div class="raw-h">Threat Intelligence</div>
        ${row('Origine', `${ev.geo.flag} ${ev.geo.country}`)}
        ${row('ASN', ev.geo.asn)}
        ${ev.intel?.match
          ? row('Réputation', `<span class="ioc-big">⚠ IOC — score ${ev.intel.score}/100</span><div class="ioc-cats">${(ev.intel.categories || []).join(' · ')}</div><small class="muted">${ev.intel.source}</small>`)
          : row('Réputation', `<span class="clean">✓ Aucune correspondance (score ${ev.intel?.score ?? 0})</span>`)}` : ''}
      <div class="raw-h">Donnée brute</div>
      <pre class="raw">${escapeHtml(JSON.stringify(ev.raw, null, 2))}</pre>`);
  }

  showBody(id) {
    const b = this.store.bodies.get(id);
    if (!b) return;
    const related = this.store.events.filter((e) => e.dst === id || e.src === id).slice(0, 7);
    this._openDetail(`Corps · ${b.label}`, `
      ${row('Hostname', b.label)}
      ${row('Identité', shortId(b.id))}
      ${row('Type', b.kind)}
      ${row('Statut', `<span class="st st-${b.status}">${statusLabel(b.status)}</span>`)}
      ${row('Criticité', '★'.repeat(b.criticality) + '☆'.repeat(3 - b.criticality))}
      ${row('Système', this.store.zones.get(b.zone)?.label || b.zone)}
      <div class="raw-h">Événements liés</div>
      <div class="mini-feed">${related.length
        ? related.map((e) => `<div class="mini sev-${e.severity}"><span>${SEV_LABEL[e.severity]}</span> ${escapeHtml(e.title)}</div>`).join('')
        : '<div class="muted">Aucun événement récent.</div>'}</div>`);
  }

  _openDetail(title, html) {
    this.$('detail-title').textContent = title;
    this.$('detail-body').innerHTML = html;
    this._rtab('detail');
  }

  // ---------- Analyse ----------
  _renderAnalytics() {
    const a = this.store.analytics();
    const totalSev = Math.max(1, SEV_ORDER.reduce((s, k) => s + a.sev[k], 0));
    const bars = SEV_ORDER.map((s) => `
      <div class="abar">
        <span class="alabel sev-${s}">${SEV_LABEL[s]}</span>
        <div class="atrack"><i class="afill bg-${s}" style="width:${(a.sev[s] / totalSev * 100).toFixed(0)}%"></i></div>
        <b>${a.sev[s]}</b>
      </div>`).join('');
    const targets = a.topTargets.length
      ? a.topTargets.map((t) => `<div class="trow st-dot-${t.status}"><span>${escapeHtml(t.label)}</span><b>${t.c}</b></div>`).join('')
      : '<div class="muted">—</div>';
    const spark = this._sparkline(this.store.rateSeries());
    this.$('rt-analyse').innerHTML = `
      <div class="acard">
        <div class="acard-h">Distribution par sévérité</div>
        ${bars}
      </div>
      <div class="acard">
        <div class="acard-h">Incidents</div>
        <div class="stat-row"><div class="stat"><span>${a.active}</span><label>actifs</label></div>
          <div class="stat"><span>${a.contained}</span><label>contenus</label></div>
          <div class="stat"><span>${(a.avgSpan / 1000).toFixed(1)}s</span><label>span kill chain</label></div></div>
      </div>
      <div class="acard">
        <div class="acard-h">Cibles les plus visées</div>
        ${targets}
      </div>
      <div class="acard">
        <div class="acard-h">Threat Intelligence</div>
        <div class="stat-row"><div class="stat ${a.iocMatches ? 'alarm' : ''}"><span>${a.iocMatches}</span><label>corresp. IOC</label></div></div>
        ${a.topCountries.length ? `<div class="raw-h" style="margin-top:8px">Origines</div>${a.topCountries.map(([c, n]) => `<div class="trow nodot"><span>${c}</span><b>${n}</b></div>`).join('')}` : ''}
      </div>
      <div class="acard">
        <div class="acard-h">Débit d'événements (60s)</div>
        <div class="spark">${spark}</div>
      </div>`;
  }

  _sparkline(series) {
    const max = Math.max(1, ...series);
    return series.map((v) => `<i style="height:${(v / max * 100).toFixed(0)}%"></i>`).join('');
  }

  // ---------- Matrice ATT&CK ----------
  _buildMatrix() {
    const grid = this.$('matrix-grid');
    grid.innerHTML = ATTACK.map(([tactic, techs]) => `
      <div class="mx-col">
        <div class="mx-head">${tactic}</div>
        ${techs.map(([id, name]) => `<div class="mx-cell" id="mx-${id}" title="${id} · ${name}">
          <span class="mx-id">${id}</span><span class="mx-name">${name}</span>
          <span class="mx-count"></span></div>`).join('')}
      </div>`).join('');
  }

  _markMatrix(ev) {
    if (!ev.mitre) return;
    const cell = this.$(`mx-${ev.mitre}`);
    if (!cell) return;
    this.mxCount[ev.mitre] = (this.mxCount[ev.mitre] || 0) + 1;
    cell.classList.add('hit', `sev-${ev.severity}`);
    cell.querySelector('.mx-count').textContent = this.mxCount[ev.mitre];
  }

  // ---------- Incidents ----------
  _renderIncidents() {
    const now = Date.now();
    const rows = this.store.incidentList().map((inc) => {
      const tgt = this.store.bodies.get(inc.target);
      const prog = Math.round((inc.stages.length / ORDER_TACTICS.length) * 100);
      const st = inc.status || 'open';
      return `<tr data-target="${inc.target}" data-inc="${inc.id}">
        <td class="mono">${inc.id}</td>
        <td>${tgt ? escapeHtml(tgt.label) : shortId(inc.target)}</td>
        <td><span class="st st-${inc.severityMax}">${SEV_LABEL[inc.severityMax]}</span></td>
        <td><div class="prog"><i style="width:${prog}%"></i></div><small>${inc.stages.length}/${ORDER_TACTICS.length} tactiques</small></td>
        <td><span class="pill pill-${st}">${INC_STATUS[st] || st}</span>${inc.owner ? `<small> · ${escapeHtml(inc.owner)}</small>` : ''}</td>
        <td class="mono">${new Date(inc.lastTs).toLocaleTimeString('fr-FR')}</td>
      </tr>`;
    }).join('');
    this.$('inc-body').innerHTML = rows || '<tr><td colspan="6" class="muted">Aucun incident.</td></tr>';
    for (const tr of this.$('inc-body').querySelectorAll('tr[data-inc]')) {
      tr.addEventListener('click', () => this.openIncident(tr.dataset.inc));
    }
  }

  // ---------- Drill-down d'incident (modal) ----------
  _buildModal() {
    this.$('modal-close').addEventListener('click', () => this._closeModal());
    this.$('modal').querySelector('.modal-back').addEventListener('click', () => this._closeModal());
  }

  _closeModal() { this.$('modal').classList.remove('open'); }

  openIncident(id) {
    const inc = this.store.incidents.get(id);
    if (!inc) return;
    const tgt = this.store.bodies.get(inc.target);
    const active = Date.now() - inc.lastTs < 20000;
    const timeline = [...inc.stages].sort((a, b) => a.ts - b.ts).map((s, i) => `
      <div class="tl-step">
        <div class="tl-dot sev-${s.severity}"></div>
        <div class="tl-body">
          <div class="tl-top"><b>${s.tactic}</b> <span class="mitre">${s.mitre || ''}</span>
            <span class="time">${new Date(s.ts).toLocaleTimeString('fr-FR')}</span></div>
          <div class="tl-title">${escapeHtml(s.title || '')}</div>
        </div>
      </div>`).join('');
    const assets = [...inc.assets].map((aid) => {
      const b = this.store.bodies.get(aid);
      return `<button class="asset-chip st-dot-${b?.status || 'nominal'}" data-focus="${aid}">${escapeHtml(b?.label || aid)}</button>`;
    }).join('');
    const events = inc.events.slice(0, 20).map((e) => `
      <div class="mini sev-${e.severity}"><span>${SEV_LABEL[e.severity]}</span>${new Date(e.ts).toLocaleTimeString('fr-FR')} · ${escapeHtml(e.title)}</div>`).join('');

    const st = inc.status || 'open';
    const notes = (inc.notes || []).map((n) => `<div class="note"><b>${escapeHtml(n.author)}</b> <span class="time">${new Date(n.ts).toLocaleTimeString('fr-FR')}</span><div>${escapeHtml(n.text)}</div></div>`).join('');
    this._openIncidentId = id;

    this.$('modal-title').innerHTML = `${inc.id} · cible <b>${tgt ? escapeHtml(tgt.label) : shortId(inc.target)}</b>
      <span class="pill pill-${st}">${INC_STATUS[st] || st}</span>${inc.owner ? `<small> · ${escapeHtml(inc.owner)}</small>` : ''}`;
    this.$('modal-body').innerHTML = `
      <div class="modal-grid">
        <div>
          <div class="raw-h">Chronologie kill chain (${inc.stages.length}/${ORDER_TACTICS.length})</div>
          <div class="timeline">${timeline || '<div class="muted">—</div>'}</div>
          <div class="raw-h" style="margin-top:16px">Notes d'investigation</div>
          <div class="notes">${notes || '<div class="muted">Aucune note.</div>'}</div>
          <div class="note-add"><input id="note-input" placeholder="Ajouter une note…" /><button id="note-btn">Ajouter</button></div>
        </div>
        <div>
          <div class="raw-h">Réponse & triage</div>
          <div class="actions">
            <button class="act" data-act="ack">✓ Prendre en charge</button>
            <button class="act danger" data-act="contain">⛔ Isoler l'hôte cible</button>
            <button class="act" data-act="resolve">✔ Résoudre</button>
            <button class="act" data-act="false_positive">⊘ Faux positif</button>
            ${(st === 'resolved' || st === 'false_positive') ? '<button class="act" data-act="reopen">↺ Rouvrir</button>' : ''}
          </div>
          <div class="raw-h" style="margin-top:16px">Actifs affectés (${inc.assets.size ?? (inc.assets.length || 0)})</div>
          <div class="assets">${assets || '<div class="muted">—</div>'}</div>
          <div class="raw-h" style="margin-top:16px">Sévérité max</div>
          <div><span class="st st-${inc.severityMax}">${SEV_LABEL[inc.severityMax]}</span></div>
          <div class="raw-h" style="margin-top:16px">Durée</div>
          <div>${((inc.lastTs - inc.firstTs) / 1000).toFixed(1)} s</div>
          <button class="big-btn" data-focus="${inc.target}" style="margin-top:14px">◉ Centrer dans le cosmos</button>
          <button class="big-btn ghost" id="inc-export" style="margin-top:8px">⬇ Exporter le rapport</button>
          <div class="raw-h" style="margin-top:16px">Événements (${inc.events.length})</div>
          <div class="mini-feed">${events}</div>
        </div>
      </div>`;
    for (const el of this.$('modal-body').querySelectorAll('[data-focus]')) {
      el.addEventListener('click', () => { this._closeModal(); this._switchView('cosmos'); this.renderer.focusBody(el.dataset.focus); });
    }
    for (const el of this.$('modal-body').querySelectorAll('[data-act]')) {
      el.addEventListener('click', () => this._incAction(id, el.dataset.act));
    }
    this.$('note-btn').addEventListener('click', () => {
      const v = this.$('note-input').value.trim();
      if (v) this._incAction(id, 'note', v);
    });
    this.$('inc-export').addEventListener('click', () => this._exportIncident(inc));
    this.$('modal').classList.add('open');
  }

  async _incAction(id, action, value) {
    try {
      await fetch(`/api/incidents/${encodeURIComponent(id)}/action`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, value, author: 'analyste' }),
      });
    } catch { /* le rafraîchissement viendra via incident_update */ }
  }

  onIncidentsMeta() { if (this.view === 'incidents') this._renderIncidents(); }

  onIncidentUpdate(inc) {
    if (this.view === 'incidents') this._renderIncidents();
    if (this.$('modal').classList.contains('open') && this._openIncidentId === inc.id) this.openIncident(inc.id);
  }

  _exportIncident(inc) {
    const tgt = this.store.bodies.get(inc.target);
    const L = (s) => SEV_LABEL[s] || s;
    const lines = [];
    lines.push(`# Rapport d'incident — ${inc.id}`, '');
    lines.push(`- **Cible** : ${tgt ? tgt.label : inc.target} (${inc.target})`);
    lines.push(`- **Sévérité maximale** : ${L(inc.severityMax)}`);
    lines.push(`- **Début** : ${new Date(inc.firstTs).toISOString()}`);
    lines.push(`- **Dernier signal** : ${new Date(inc.lastTs).toISOString()}`);
    lines.push(`- **Durée** : ${((inc.lastTs - inc.firstTs) / 1000).toFixed(1)} s`);
    lines.push(`- **Actifs affectés** : ${[...inc.assets].map((a) => this.store.bodies.get(a)?.label || a).join(', ') || '—'}`, '');
    lines.push('## Chronologie MITRE ATT&CK', '');
    for (const s of [...inc.stages].sort((a, b) => a.ts - b.ts)) {
      lines.push(`- \`${new Date(s.ts).toLocaleTimeString('fr-FR')}\` **${s.tactic}** (${s.mitre || '—'}) — ${s.title || ''} [${L(s.severity)}]`);
    }
    lines.push('', `## Événements (${inc.events.length})`, '');
    for (const e of [...inc.events].reverse()) {
      lines.push(`- \`${new Date(e.ts).toLocaleTimeString('fr-FR')}\` [${L(e.severity)}] ${e.title} — ${shortId(e.src)} → ${shortId(e.dst)}`);
    }
    lines.push('', `_Généré par Orion SOC — ${new Date().toISOString()}_`);
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${inc.id}-rapport.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ---------- Command palette ----------
  _buildPalette() {
    this.palItems = [];
    this.palSel = 0;
    const input = this.$('palette-input');
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this._togglePalette(); }
      else if (e.key === 'Escape') { this._closePalette(); this._closeModal(); }
      else if (this.$('palette').classList.contains('open')) {
        if (e.key === 'ArrowDown') { e.preventDefault(); this.palSel = Math.min(this.palSel + 1, this.palItems.length - 1); this._highlightPalette(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.palSel = Math.max(this.palSel - 1, 0); this._highlightPalette(); }
        else if (e.key === 'Enter') { e.preventDefault(); this._execPalette(this.palItems[this.palSel]); }
      }
    });
    input.addEventListener('input', () => this._renderPalette(input.value));
    this.$('palette').querySelector('.palette-back').addEventListener('click', () => this._closePalette());
  }

  _togglePalette() {
    const p = this.$('palette');
    if (p.classList.contains('open')) return this._closePalette();
    p.classList.add('open');
    const i = this.$('palette-input'); i.value = ''; i.focus();
    this._renderPalette('');
  }

  _closePalette() { this.$('palette').classList.remove('open'); }

  _renderPalette(q) {
    q = q.trim().toLowerCase();
    const cmds = [
      { kind: 'Vue', label: 'Cosmos', act: () => this._switchView('cosmos') },
      { kind: 'Vue', label: 'Matrice ATT&CK', act: () => this._switchView('matrix') },
      { kind: 'Vue', label: 'Incidents', act: () => { this._switchView('incidents'); } },
      { kind: 'Action', label: 'Basculer mode analyste', act: () => this.$('analyst').click() },
    ];
    const assets = [...this.store.bodies.values()].filter((b) => b.kind !== 'external')
      .map((b) => ({ kind: 'Actif', label: `${b.label} · ${shortId(b.id)}`, focus: b.id, status: b.status }));
    const incidents = this.store.incidentList().slice(0, 8)
      .map((inc) => ({ kind: 'Incident', label: `${inc.id} · ${SEV_LABEL[inc.severityMax]}`, inc: inc.id }));
    const all = [...cmds, ...incidents, ...assets];
    this.palItems = (q ? all.filter((x) => x.label.toLowerCase().includes(q) || x.kind.toLowerCase().includes(q)) : all).slice(0, 9);
    this.palSel = 0;
    this.$('palette-results').innerHTML = this.palItems.map((x, i) => `
      <div class="pal-item ${i === 0 ? 'sel' : ''}" data-i="${i}">
        <span class="pal-kind">${x.kind}</span><span class="pal-label">${escapeHtml(x.label)}</span></div>`).join('')
      || '<div class="pal-empty muted">Aucun résultat</div>';
    for (const el of this.$('palette-results').querySelectorAll('.pal-item')) {
      el.addEventListener('click', () => this._execPalette(this.palItems[+el.dataset.i]));
    }
  }

  _highlightPalette() {
    for (const el of this.$('palette-results').querySelectorAll('.pal-item')) el.classList.toggle('sel', +el.dataset.i === this.palSel);
  }

  _execPalette(item) {
    if (!item) return;
    this._closePalette();
    if (item.act) item.act();
    else if (item.focus) { this._switchView('cosmos'); this.renderer.focusBody(item.focus); }
    else if (item.inc) { this._switchView('incidents'); this.openIncident(item.inc); }
  }

  // ---------- Kill chain (footer) ----------
  _renderKillChain(inc) {
    if (!inc) return;
    const done = new Set(inc.stages.map((s) => s.tactic));
    const tgt = this.store.bodies.get(inc.target);
    this.$('kc-title').innerHTML =
      `<b>${inc.id}</b> · cible ${tgt ? escapeHtml(tgt.label) : shortId(inc.target)} · <span class="st st-${inc.severityMax}">${SEV_LABEL[inc.severityMax]}</span>`;
    this.$('kc-strip').innerHTML = ORDER_TACTICS.map((t) =>
      `<div class="kc-step ${done.has(t) ? 'on' : ''}">${t}</div>`).join('<span class="kc-arrow">›</span>');
  }

  // ---------- Toasts ----------
  _toast(ev) {
    const box = this.$('toasts');
    const el = document.createElement('div');
    el.className = `toast sev-${ev.severity}`;
    el.innerHTML = `<span class="badge">${SEV_LABEL[ev.severity]}</span><div>${escapeHtml(ev.title)}</div>`;
    el.addEventListener('click', () => { this.showEvent(ev); el.remove(); });
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 4600);
    setTimeout(() => el.remove(), 5200);
  }

  _flash() {
    const el = this.$('flash');
    el.classList.add('on');
    setTimeout(() => el.classList.remove('on'), 220);
  }
}

function row(k, v) { return `<div class="drow"><span>${k}</span><div>${v}</div></div>`; }
function shortId(id) { return String(id).replace(/^host-/, '').replace(/^ext-/, '⌖ '); }
function statusLabel(s) {
  return { nominal: 'Nominal', scanning: 'Sous scan', under_attack: 'Attaqué', compromised: 'COMPROMIS', offline: 'Hors-ligne' }[s] || s;
}
function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
