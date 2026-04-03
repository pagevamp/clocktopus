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
    h1 { font-size: 1.8rem; margin-bottom: 1.5rem; color: #fff; }
    .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1.5rem; }
    .card { background: #1c1f26; border: 1px solid #2d3139; border-radius: 12px; padding: 1.5rem; }
    .card-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
    .card-header h2 { font-size: 1.1rem; color: #fff; }
    .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .dot.green { background: #3fb950; }
    .dot.red { background: #f85149; }
    .dot.gray { background: #484f58; }
    label { display: block; font-size: 0.85rem; color: #8b949e; margin-bottom: 0.25rem; margin-top: 0.75rem; }
    input { width: 100%; padding: 0.5rem 0.75rem; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #e1e4e8; font-size: 0.9rem; }
    input:focus { outline: none; border-color: #58a6ff; }
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
  </style>
</head>
<body>
  <h1>Clocktopus Dashboard</h1>
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
      <div class="msg" id="jira-msg"></div>
    </div>

  </div>

  <script>
    function setMsg(id, text, ok) {
      const el = document.getElementById(id);
      el.textContent = text;
      el.className = 'msg ' + (ok ? 'ok' : 'err');
    }

    function setDot(id, color) {
      document.getElementById(id).className = 'dot ' + color;
    }

    function setGoogleConnected(connected, email) {
      const btn = document.getElementById('google-connect-btn');
      const desc = document.getElementById('google-desc');
      if (connected) {
        btn.textContent = 'Reconnect';
        btn.disabled = false;
        if (email) {
          desc.textContent = 'Connected as ' + email;
          desc.style.color = '#3fb950';
        } else {
          desc.textContent = 'Connected';
          desc.style.color = '#3fb950';
        }
      } else {
        btn.textContent = 'Connect Google Account';
        btn.disabled = false;
        desc.textContent = 'Authorize access to your Google Calendar.';
        desc.style.color = '#8b949e';
      }
    }

    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setDot('clockify-dot', data.clockify ? 'green' : 'red');
        setDot('google-dot', data.google ? 'green' : 'red');
        setDot('jira-dot', data.jira ? 'green' : 'red');
        setGoogleConnected(data.google, data.googleEmail);
      } catch {}
    }

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
      } catch (e) {
        setMsg('clockify-msg', 'Request failed.', false);
      }
    }

    function connectGoogle() {
      window.location.href = '/api/google/connect';
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
      } catch (e) {
        setMsg('jira-msg', 'Request failed.', false);
      }
    }

    fetchStatus();
  </script>
</body>
</html>`;
}
