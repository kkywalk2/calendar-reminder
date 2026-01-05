import { Router, Request, Response, NextFunction } from 'express';
import { queries, User } from '../db';

const router = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.redirect('/auth/google');
  }
  next();
}

router.get('/', requireAuth, (req, res) => {
  const user = queries.getUserById.get(req.session.userId!) as User | undefined;

  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/auth/google');
  }

  const saved = req.query.saved === '1';
  res.send(renderDashboard(user, saved));
});

router.post('/settings', requireAuth, (req, res) => {
  const { discord_webhook_url, reminder_minutes, enabled } = req.body;

  queries.updateUserSettings.run({
    id: req.session.userId!,
    discord_webhook_url: discord_webhook_url || null,
    reminder_minutes: parseInt(reminder_minutes) || 10,
    enabled: enabled === 'on' ? 1 : 0,
  });

  res.redirect('/dashboard?saved=1');
});

function renderDashboard(user: User, saved: boolean): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Calendar Reminder - Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 2rem;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    h1 {
      color: #7c3aed;
      margin-bottom: 0.5rem;
    }
    .user-info {
      color: #888;
      margin-bottom: 2rem;
    }
    .card {
      background: #16213e;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      color: #aaa;
      font-size: 0.9rem;
    }
    input[type="text"], input[type="number"] {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #333;
      border-radius: 8px;
      background: #0f0f23;
      color: #eee;
      font-size: 1rem;
      margin-bottom: 1rem;
    }
    input:focus {
      outline: none;
      border-color: #7c3aed;
    }
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .checkbox-group input {
      width: 1.2rem;
      height: 1.2rem;
    }
    button {
      background: #7c3aed;
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #6d28d9;
    }
    .success {
      background: #065f46;
      color: #a7f3d0;
      padding: 0.75rem;
      border-radius: 8px;
      margin-bottom: 1rem;
    }
    .logout {
      display: inline-block;
      margin-top: 1rem;
      color: #888;
      text-decoration: none;
    }
    .logout:hover {
      color: #ef4444;
    }
    .help {
      font-size: 0.8rem;
      color: #666;
      margin-top: -0.5rem;
      margin-bottom: 1rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Calendar Reminder</h1>
    <p class="user-info">${user.email}</p>

    ${saved ? '<div class="success">Settings saved!</div>' : ''}

    <form method="POST" action="/dashboard/settings" class="card">
      <label for="discord_webhook_url">Discord Webhook URL</label>
      <input
        type="text"
        id="discord_webhook_url"
        name="discord_webhook_url"
        value="${user.discord_webhook_url || ''}"
        placeholder="https://discord.com/api/webhooks/..."
      />
      <p class="help">Discord 채널 설정 → 연동 → 웹후크에서 생성</p>

      <label for="reminder_minutes">알림 시간 (분 전)</label>
      <input
        type="number"
        id="reminder_minutes"
        name="reminder_minutes"
        value="${user.reminder_minutes}"
        min="1"
        max="60"
      />

      <div class="checkbox-group">
        <input
          type="checkbox"
          id="enabled"
          name="enabled"
          ${user.enabled ? 'checked' : ''}
        />
        <label for="enabled" style="margin: 0; color: #eee;">알림 활성화</label>
      </div>

      <button type="submit">저장</button>
    </form>

    <a href="/auth/logout" class="logout">로그아웃</a>
  </div>

  <script>
    if (new URLSearchParams(window.location.search).get('saved')) {
      history.replaceState(null, '', '/dashboard');
    }
  </script>
</body>
</html>`;
}

export default router;
