export function indexPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clocktopus Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e1e4e8; padding: 2rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0; color: #fff; }
    h2 { font-size: 1.1rem; color: #fff; margin-bottom: 1rem; }

    /* Nav */
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; }
    .nav { display: flex; gap: 0.25rem; background: #1c1f26; border-radius: 8px; padding: 0.25rem; }
    .nav-btn { padding: 0.5rem 1.25rem; border: none; border-radius: 6px; background: transparent; color: #8b949e; font-size: 0.9rem; cursor: pointer; }
    .nav-btn:hover { color: #e1e4e8; }
    .nav-btn.active { background: #30363d; color: #fff; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Cards */
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1.5rem; }
    .card { background: #1c1f26; border: 1px solid #2d3139; border-radius: 12px; padding: 1.5rem; }
    .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .card-header h2 { margin-bottom: 0; }
    .card-full { grid-column: 1 / -1; }

    /* Active timer */
    .active-timer { border-left: 3px solid #3fb950; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .active-timer .timer-info { flex: 1; }
    .active-timer .timer-desc { font-size: 1rem; color: #fff; font-weight: 500; }
    .active-timer .timer-elapsed { font-size: 0.9rem; color: #3fb950; margin-top: 0.25rem; }
    .stop-btn { background: #da3633; margin-top: 0; }
    .stop-btn:hover { background: #f85149; }

    /* Form elements */
    .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .dot.green { background: #3fb950; }
    .dot.red { background: #f85149; }
    .dot.gray { background: #484f58; }
    label { display: block; font-size: 0.85rem; color: #8b949e; margin-bottom: 0.25rem; margin-top: 0.75rem; }
    input, select { width: 100%; padding: 0.5rem 0.75rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; font-size: 0.9rem; }
    input:focus, select:focus { outline: none; border-color: #58a6ff; }
    select { appearance: none; -webkit-appearance: none; cursor: pointer; }
    button { margin-top: 1rem; padding: 0.5rem 1.25rem; background: #238636; border: none; border-radius: 6px; color: #fff; font-size: 0.9rem; cursor: pointer; }
    button:hover { background: #2ea043; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.connect { background: #1f6feb; }
    button.connect:hover { background: #388bfd; }
    .msg { font-size: 0.85rem; margin-top: 0.5rem; }
    .msg.ok { color: #3fb950; }
    .msg.err { color: #f85149; }
    .guide { font-size: 0.8rem; color: #8b949e; margin-bottom: 0.25rem; }
    .guide a { color: #58a6ff; text-decoration: none; }
    .guide a:hover { text-decoration: underline; }
    .guide ol { margin: 0.25rem 0 0 1.25rem; }
    .guide li { margin-bottom: 0.15rem; }

    /* Sessions table */
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .sessions-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; min-width: 540px; }
    .sessions-table th { text-align: left; color: #8b949e; padding: 0.5rem 0.75rem; border-bottom: 1px solid #30363d; font-weight: 500; white-space: nowrap; }
    .sessions-table td { padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d; }
    .sessions-table tr:hover { background: #161b22; }
    .sessions-table .in-progress { color: #3fb950; font-style: italic; }
    .empty-state { color: #8b949e; font-size: 0.9rem; padding: 2rem; text-align: center; }

    /* Inline form row */
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 600px) { .form-row { grid-template-columns: 1fr; } }
    /* Project toggles */
    .project-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0; border-bottom: 1px solid #21262d; }
    .project-item:last-child { border-bottom: none; }
    .project-item label { margin: 0; color: #e1e4e8; font-size: 0.9rem; cursor: pointer; flex: 1; }
    .toggle { position: relative; width: 36px; height: 20px; flex-shrink: 0; }
    .toggle input { opacity: 0; width: 100%; height: 100%; position: absolute; inset: 0; z-index: 1; cursor: pointer; margin: 0; }
    .toggle .slider { position: absolute; inset: 0; background: #30363d; border-radius: 10px; cursor: pointer; transition: background 0.2s; pointer-events: none; }
    .toggle .slider::before { content: ''; position: absolute; width: 16px; height: 16px; left: 2px; top: 2px; background: #8b949e; border-radius: 50%; transition: transform 0.2s, background 0.2s; }
    .toggle input:checked + .slider { background: #238636; }
    .toggle input:checked + .slider::before { transform: translateX(16px); background: #fff; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Clocktopus</h1>
    <div class="nav">
      <button class="nav-btn active" onclick="switchTab('home')" id="nav-home">Home</button>
      <button class="nav-btn" onclick="switchTab('projects')" id="nav-projects">Projects</button>
      <button class="nav-btn" onclick="switchTab('settings')" id="nav-settings">Settings</button>
    </div>
  </div>

  <!-- HOME TAB -->
  <div id="tab-home" class="tab-content active">

    <!-- Active Timer Banner -->
    <div id="active-timer" class="card active-timer" style="display:none; margin-bottom:1.5rem;">
      <div class="timer-info">
        <div class="timer-desc" id="active-timer-desc"></div>
        <div class="timer-elapsed" id="active-timer-elapsed"></div>
      </div>
      <button class="stop-btn" onclick="stopTimer()">Stop Timer</button>
    </div>

    <div class="cards">
      <!-- Start Timer -->
      <div class="card">
        <h2>Start Timer</h2>
        <div id="start-timer-form">
          <label for="project-select">Project</label>
          <select id="project-select">
            <option value="">Loading projects...</option>
          </select>
          <div class="form-row">
            <div>
              <label for="timer-description">Description</label>
              <input type="text" id="timer-description" placeholder="What are you working on?" />
            </div>
            <div>
              <label for="timer-jira">Jira Ticket (optional)</label>
              <input type="text" id="timer-jira" placeholder="e.g. PROJ-123" />
            </div>
          </div>
          <button id="start-btn" onclick="startTimer()">Start Timer</button>
        </div>
        <div class="msg" id="timer-msg"></div>
      </div>

      <!-- Monitor Control -->
      <div class="card">
        <div class="card-header">
          <div class="dot gray" id="monitor-dot"></div>
          <h2>Idle Monitor</h2>
        </div>
        <p id="monitor-desc" style="font-size:0.85rem;color:#8b949e;margin-bottom:0.5rem;">Auto-stops timers when idle, resumes when active.</p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button id="monitor-start-btn" onclick="monitorAction('start')" style="margin-top:0;">Start</button>
          <button id="monitor-stop-btn" onclick="monitorAction('stop')" class="stop-btn" style="margin-top:0;" disabled>Stop</button>
          <button id="monitor-restart-btn" onclick="monitorAction('restart')" style="margin-top:0;background:#30363d;" disabled>Restart</button>
        </div>
        <div class="msg" id="monitor-msg"></div>
      </div>

      <!-- Session History -->
      <div class="card card-full">
        <h2>Recent Sessions</h2>
        <div id="sessions-container" class="table-wrap">
          <table class="sessions-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Project</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Jira</th>
              </tr>
            </thead>
            <tbody id="sessions-body">
              <tr><td colspan="5" class="empty-state">Loading...</td></tr>
            </tbody>
          </table>
          <div id="pagination" style="display:none; margin-top:1rem; display:flex; align-items:center; justify-content:space-between;">
            <button id="prev-btn" onclick="changePage(-1)" style="background:#30363d;" disabled>Previous</button>
            <span id="page-info" style="font-size:0.85rem; color:#8b949e;"></span>
            <button id="next-btn" onclick="changePage(1)" style="background:#30363d;">Next</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- SETTINGS TAB -->
  <div id="tab-settings" class="tab-content">
    <div class="cards">

      <!-- Clockify -->
      <div class="card">
        <div class="card-header">
          <div class="dot gray" id="clockify-dot"></div>
          <h2>Clockify</h2>
        </div>
        <div class="guide">
          <ol>
            <li>Go to <a href="https://app.clockify.me/manage-api-keys" target="_blank">Manage API Keys</a></li>
            <li>Click <strong>Generate</strong>, enter a name, and confirm</li>
            <li>Copy the key and paste it below</li>
          </ol>
        </div>
        <label for="clockify-key">API Key</label>
        <input type="password" id="clockify-key" placeholder="Enter your Clockify API key" />
        <button onclick="saveClockify()">Save &amp; Validate</button>
        <div class="msg" id="clockify-msg"></div>
      </div>

      <!-- Google Calendar -->
      <div class="card">
        <div class="card-header">
          <div class="dot gray" id="google-dot"></div>
          <h2>Google Calendar</h2>
        </div>
        <p id="google-desc" style="font-size:0.85rem;color:#8b949e;margin-bottom:0.5rem;">Authorize access to your Google Calendar.</p>
        <button class="connect" id="google-connect-btn" onclick="connectGoogle()">Connect Google Account</button>
        <div class="msg" id="google-msg"></div>
      </div>

      <!-- Jira -->
      <div class="card">
        <div class="card-header">
          <div class="dot gray" id="jira-dot"></div>
          <h2>Jira</h2>
        </div>
        <p id="jira-desc" style="font-size:0.85rem;color:#8b949e;margin-bottom:0.5rem;">Connect your Atlassian account to log time on Jira tickets.</p>
        <button class="connect" id="jira-connect-btn" onclick="connectJira()">Connect Atlassian</button>
        <div class="msg" id="jira-msg"></div>
        <div style="margin-top:1rem;">
          <a href="#" id="jira-toggle" onclick="toggleJiraForm(event)" style="font-size:0.8rem;color:#8b949e;text-decoration:none;">or use API token &darr;</a>
          <div id="jira-form" style="display:none;margin-top:0.5rem;">
            <div class="guide">
              <ol>
                <li>Go to <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank">Atlassian API Tokens</a></li>
                <li>Click <strong>Create API token</strong> and copy it</li>
                <li>Your URL is <code>https://&lt;your-org&gt;.atlassian.net/rest/api/3</code></li>
              </ol>
            </div>
            <label for="jira-url">Atlassian URL</label>
            <input type="text" id="jira-url" placeholder="https://your-org.atlassian.net/rest/api/3" />
            <label for="jira-email">Email</label>
            <input type="email" id="jira-email" placeholder="you@example.com" />
            <label for="jira-token">API Token</label>
            <input type="password" id="jira-token" placeholder="Atlassian API token" />
            <button onclick="saveJira()">Save &amp; Validate</button>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- PROJECTS TAB -->
  <div id="tab-projects" class="tab-content">
    <div class="card">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:1rem;">
        <h2 style="margin-bottom:0;">Projects</h2>
        <button id="fetch-projects-btn" onclick="fetchProjects()" style="margin-top:0; background:#1f6feb;">Pull from Clockify</button>
      </div>
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
        <p style="font-size:0.8rem; color:#8b949e; margin:0;">Toggle projects on/off to control which appear in the timer dropdown.</p>
        <a href="#" id="toggle-all-link" onclick="toggleAllProjects(event)" style="font-size:0.8rem; color:#58a6ff; text-decoration:none; white-space:nowrap; margin-left:1rem;">Deselect all</a>
      </div>
      <div class="msg" id="projects-msg"></div>
      <div id="projects-list" style="margin-top:0.5rem;"></div>
    </div>
  </div>

  <script>
    let elapsedInterval = null;
    let currentPage = 1;
    let totalPages = 1;

    // --- Tab switching ---
    function switchTab(tab) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
      document.getElementById('tab-' + tab).classList.add('active');
      document.getElementById('nav-' + tab).classList.add('active');
    }

    // --- Utilities ---
    function setMsg(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = 'msg ' + (ok ? 'ok' : 'err');
    }

    function setDot(id, color) {
      document.getElementById(id).className = 'dot ' + color;
    }

    function formatDuration(ms) {
      const totalSec = Math.floor(ms / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function formatDate(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    // --- Timer ---
    async function checkActiveTimer() {
      try {
        const res = await fetch('/api/timer/active');
        const data = await res.json();
        const banner = document.getElementById('active-timer');
        const startBtn = document.getElementById('start-btn');

        if (data.active) {
          document.getElementById('active-timer-desc').textContent = data.description || 'Timer running';
          banner.style.display = 'flex';
          startBtn.disabled = true;
          startBtn.textContent = 'Timer Running...';

          if (elapsedInterval) clearInterval(elapsedInterval);
          const startTime = new Date(data.start).getTime();
          function updateElapsed() {
            const elapsed = Date.now() - startTime;
            document.getElementById('active-timer-elapsed').textContent = formatDuration(elapsed);
          }
          updateElapsed();
          elapsedInterval = setInterval(updateElapsed, 1000);
        } else {
          banner.style.display = 'none';
          startBtn.disabled = false;
          startBtn.textContent = 'Start Timer';
          if (elapsedInterval) { clearInterval(elapsedInterval); elapsedInterval = null; }
        }
      } catch {}
    }

    async function startTimer() {
      const projectId = document.getElementById('project-select').value;
      const description = document.getElementById('timer-description').value.trim();
      const jiraTicket = document.getElementById('timer-jira').value.trim();

      if (!projectId) return setMsg('timer-msg', 'Please select a project.', false);
      if (!description && !jiraTicket) return setMsg('timer-msg', 'Please enter a description or Jira ticket.', false);

      const btn = document.getElementById('start-btn');
      btn.disabled = true;
      btn.textContent = 'Starting...';

      try {
        const res = await fetch('/api/timer/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId, description: description || 'Working on a task...', jiraTicket: jiraTicket || undefined }),
        });
        const data = await res.json();
        if (data.ok) {
          setMsg('timer-msg', 'Timer started!', true);
          document.getElementById('timer-description').value = '';
          document.getElementById('timer-jira').value = '';
          checkActiveTimer();
          loadSessions();
        } else {
          setMsg('timer-msg', data.error || 'Failed to start timer.', false);
          btn.disabled = false;
          btn.textContent = 'Start Timer';
        }
      } catch {
        setMsg('timer-msg', 'Request failed.', false);
        btn.disabled = false;
        btn.textContent = 'Start Timer';
      }
    }

    async function stopTimer() {
      try {
        const res = await fetch('/api/timer/stop', {
          method: 'POST',
        });
        const data = await res.json();
        if (data.ok) {
          setMsg('timer-msg', 'Timer stopped.', true);
          checkActiveTimer();
          loadSessions();
        } else {
          setMsg('timer-msg', data.error || 'Failed to stop timer.', false);
        }
      } catch {
        setMsg('timer-msg', 'Request failed.', false);
      }
    }

    // --- Monitor ---
    async function checkMonitorStatus() {
      try {
        const res = await fetch('/api/monitor/status');
        const data = await res.json();
        const dot = document.getElementById('monitor-dot');
        const desc = document.getElementById('monitor-desc');
        const startBtn = document.getElementById('monitor-start-btn');
        const stopBtn = document.getElementById('monitor-stop-btn');
        const restartBtn = document.getElementById('monitor-restart-btn');

        if (data.running) {
          dot.className = 'dot green';
          const uptime = data.uptime ? formatDuration(Date.now() - data.uptime) : '';
          desc.textContent = 'Running' + (uptime ? ' for ' + uptime : '') + (data.restarts > 0 ? ' (' + data.restarts + ' restarts)' : '');
          desc.style.color = '#3fb950';
          startBtn.disabled = true;
          stopBtn.disabled = false;
          restartBtn.disabled = false;
        } else {
          dot.className = 'dot red';
          desc.textContent = data.status === 'stopped' ? 'Stopped' : 'Not running';
          desc.style.color = '#8b949e';
          startBtn.disabled = false;
          stopBtn.disabled = true;
          restartBtn.disabled = true;
        }
      } catch {
        document.getElementById('monitor-dot').className = 'dot gray';
      }
    }

    async function monitorAction(action) {
      setMsg('monitor-msg', '', true);
      try {
        const res = await fetch('/api/monitor/' + action, { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          setMsg('monitor-msg', 'Monitor ' + action + (action === 'stop' ? 'ped' : 'ed') + '.', true);
        } else {
          setMsg('monitor-msg', data.output || 'Failed.', false);
        }
        setTimeout(checkMonitorStatus, 1000);
      } catch {
        setMsg('monitor-msg', 'Request failed.', false);
      }
    }

    // --- Projects ---
    async function loadProjects() {
      try {
        const res = await fetch('/api/projects');
        const projects = await res.json();
        const select = document.getElementById('project-select');
        select.innerHTML = '<option value="">Select a project</option>';
        if (projects.length === 0) {
          select.innerHTML = '<option value="">No active projects \u2014 pull from Clockify in Settings</option>';
          return;
        }
        projects.forEach(function(p) {
          const opt = document.createElement('option');
          opt.value = p.id;
          opt.textContent = p.name;
          select.appendChild(opt);
        });
      } catch {
        document.getElementById('project-select').innerHTML = '<option value="">Failed to load projects</option>';
      }
    }

    async function fetchProjects() {
      const btn = document.getElementById('fetch-projects-btn');
      btn.disabled = true;
      btn.textContent = 'Fetching...';
      try {
        const res = await fetch('/api/projects/fetch', { method: 'POST' });
        const data = await res.json();
        if (data.ok) {
          setMsg('projects-msg', 'Pulled ' + data.count + ' projects from Clockify.', true);
          loadAllProjects();
          loadProjects();
        } else {
          setMsg('projects-msg', data.error || 'Failed.', false);
        }
      } catch {
        setMsg('projects-msg', 'Request failed.', false);
      }
      btn.disabled = false;
      btn.textContent = 'Pull from Clockify';
    }

    async function loadAllProjects() {
      try {
        const res = await fetch('/api/projects/all');
        const projects = await res.json();
        const container = document.getElementById('projects-list');

        if (projects.length === 0) {
          container.innerHTML = '<p style="color:#8b949e;font-size:0.85rem;">No projects yet. Click "Pull from Clockify" to import them.</p>';
          return;
        }

        container.innerHTML = projects.map(function(p) {
          return '<div class="project-item">' +
            '<div class="toggle">' +
              '<input type="checkbox" data-project-id="' + p.id + '" id="proj-' + p.id + '" ' + (p.active ? 'checked' : '') + ' />' +
              '<span class="slider"></span>' +
            '</div>' +
            '<label for="proj-' + p.id + '">' + escapeHtml(p.name) + '</label>' +
          '</div>';
        }).join('');
        container.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
          cb.addEventListener('change', function() {
            toggleProject(cb.dataset.projectId, cb.checked);
          });
        });
      } catch {
        document.getElementById('projects-list').innerHTML = '<p style="color:#f85149;font-size:0.85rem;">Failed to load projects.</p>';
      }
    }

    async function toggleProject(id, active) {
      try {
        const res = await fetch('/api/projects/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, active }),
        });
        if (!res.ok) console.error('Toggle failed:', await res.text());
        loadProjects();
        loadAllProjects();
        updateToggleAllLink();
      } catch (e) { console.error('Toggle error:', e); }
    }

    async function toggleAllProjects(e) {
      e.preventDefault();
      const checkboxes = document.querySelectorAll('#projects-list input[type="checkbox"]');
      if (checkboxes.length === 0) return;
      const allChecked = Array.from(checkboxes).every(function(cb) { return cb.checked; });
      const newState = !allChecked;
      const promises = Array.from(checkboxes).map(function(cb) {
        cb.checked = newState;
        const id = cb.id.replace('proj-', '');
        return fetch('/api/projects/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, active: newState }),
        });
      });
      await Promise.all(promises);
      loadProjects();
      updateToggleAllLink();
    }

    function updateToggleAllLink() {
      const checkboxes = document.querySelectorAll('#projects-list input[type="checkbox"]');
      const link = document.getElementById('toggle-all-link');
      if (!link || checkboxes.length === 0) return;
      const allChecked = Array.from(checkboxes).every(function(cb) { return cb.checked; });
      link.textContent = allChecked ? 'Deselect all' : 'Select all';
    }

    // --- Sessions ---
    async function loadSessions() {
      try {
        const res = await fetch('/api/sessions?page=' + currentPage + '&limit=10');
        const result = await res.json();
        const sessions = result.data;
        totalPages = result.totalPages;
        const tbody = document.getElementById('sessions-body');
        const pagination = document.getElementById('pagination');

        if (sessions.length === 0 && currentPage === 1) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No sessions yet. Start a timer to get going!</td></tr>';
          pagination.style.display = 'none';
          return;
        }

        tbody.innerHTML = sessions.map(function(s) {
          const started = formatDate(s.startedAt);
          let duration;
          if (s.completedAt) {
            const ms = new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime();
            duration = formatDuration(ms);
          } else {
            duration = '<span class="in-progress">In progress</span>';
          }
          const jira = s.jiraTicket || '-';
          return '<tr>' +
            '<td>' + escapeHtml(s.description) + '</td>' +
            '<td>' + escapeHtml(s.projectName) + '</td>' +
            '<td>' + started + '</td>' +
            '<td>' + duration + '</td>' +
            '<td>' + escapeHtml(jira) + '</td>' +
            '</tr>';
        }).join('');

        // Update pagination controls
        pagination.style.display = totalPages > 1 ? 'flex' : 'none';
        document.getElementById('prev-btn').disabled = currentPage <= 1;
        document.getElementById('next-btn').disabled = currentPage >= totalPages;
        document.getElementById('page-info').textContent = 'Page ' + currentPage + ' of ' + totalPages + ' (' + result.total + ' sessions)';
      } catch {
        document.getElementById('sessions-body').innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load sessions.</td></tr>';
      }
    }

    function changePage(delta) {
      const newPage = currentPage + delta;
      if (newPage < 1 || newPage > totalPages) return;
      currentPage = newPage;
      loadSessions();
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // --- Settings: Clockify ---
    async function saveClockify() {
      const apiKey = document.getElementById('clockify-key').value.trim();
      if (!apiKey) return setMsg('clockify-msg', 'API key is required.', false);
      try {
        const res = await fetch('/api/clockify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey }),
        });
        const data = await res.json();
        if (data.ok) {
          setMsg('clockify-msg', 'Saved and validated successfully.', true);
          setDot('clockify-dot', 'green');
        } else {
          setMsg('clockify-msg', data.error || 'Validation failed.', false);
          setDot('clockify-dot', 'red');
        }
      } catch {
        setMsg('clockify-msg', 'Request failed.', false);
      }
    }

    // --- Settings: Google ---
    function setGoogleConnected(connected, email) {
      const btn = document.getElementById('google-connect-btn');
      const desc = document.getElementById('google-desc');
      if (connected) {
        btn.textContent = 'Reconnect';
        desc.textContent = 'Connected' + (email ? ' as ' + email : '');
        desc.style.color = '#3fb950';
      } else {
        btn.textContent = 'Connect Google Account';
        desc.textContent = 'Authorize access to your Google Calendar.';
        desc.style.color = '#8b949e';
      }
    }

    function connectGoogle() {
      window.location.href = '/api/google/connect';
    }

    // --- Settings: Jira ---
    function setJiraConnected(connected, isOAuth, siteUrl) {
      const btn = document.getElementById('jira-connect-btn');
      const desc = document.getElementById('jira-desc');
      if (connected && isOAuth) {
        btn.textContent = 'Reconnect';
        desc.textContent = 'Connected via OAuth' + (siteUrl ? ' (' + siteUrl.replace('https://', '') + ')' : '');
        desc.style.color = '#3fb950';
      } else if (connected) {
        btn.textContent = 'Reconnect';
        desc.textContent = 'Connected via API token';
        desc.style.color = '#3fb950';
      } else {
        btn.textContent = 'Connect Atlassian';
        desc.textContent = 'Connect your Atlassian account to log time on Jira tickets.';
        desc.style.color = '#8b949e';
      }
    }

    function connectJira() {
      window.location.href = '/api/jira/connect';
    }

    function toggleJiraForm(e) {
      e.preventDefault();
      const form = document.getElementById('jira-form');
      const toggle = document.getElementById('jira-toggle');
      if (form.style.display === 'none') {
        form.style.display = 'block';
        toggle.innerHTML = 'hide API token form &uarr;';
      } else {
        form.style.display = 'none';
        toggle.innerHTML = 'or use API token &darr;';
      }
    }

    async function saveJira() {
      const url = document.getElementById('jira-url').value.trim();
      const email = document.getElementById('jira-email').value.trim();
      const token = document.getElementById('jira-token').value.trim();
      if (!url || !email || !token) return setMsg('jira-msg', 'All fields are required.', false);
      try {
        const res = await fetch('/api/jira', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, email, token }),
        });
        const data = await res.json();
        if (data.ok) {
          setMsg('jira-msg', 'Saved and validated successfully.', true);
          setDot('jira-dot', 'green');
        } else {
          setMsg('jira-msg', data.error || 'Validation failed.', false);
          setDot('jira-dot', 'red');
        }
      } catch {
        setMsg('jira-msg', 'Request failed.', false);
      }
    }

    // --- Status ---
    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setDot('clockify-dot', data.clockify ? 'green' : 'red');
        setDot('google-dot', data.google ? 'green' : 'red');
        setDot('jira-dot', data.jira ? 'green' : 'red');
        setGoogleConnected(data.google, data.googleEmail);
        setJiraConnected(data.jira, data.jiraOAuth, data.jiraSiteUrl);
      } catch {}
    }

    // --- OAuth callback params ---
    (function checkUrlParams() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('jira') === 'connected') {
        switchTab('settings');
        setTimeout(function() {
          setMsg('jira-msg', 'Connected to ' + (params.get('site') || 'Atlassian') + ' successfully!', true);
          setDot('jira-dot', 'green');
        }, 100);
        window.history.replaceState({}, '', '/');
      } else if (params.get('jira') === 'error') {
        switchTab('settings');
        setTimeout(function() {
          setMsg('jira-msg', 'Connection failed: ' + (params.get('reason') || 'unknown error'), false);
        }, 100);
        window.history.replaceState({}, '', '/');
      }
    })();

    // --- Init ---
    fetchStatus();
    loadProjects();
    loadSessions();
    checkActiveTimer();
    checkMonitorStatus();
    loadAllProjects();
  </script>
</body>
</html>`;
}
