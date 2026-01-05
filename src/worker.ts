import 'dotenv/config';
import { CronJob } from 'cron';
import { google, calendar_v3 } from 'googleapis';
import { queries, User } from './db';

const REMINDER_MINUTES = parseInt(process.env.REMINDER_MINUTES || '10');

interface CalendarEvent {
  id: string;
  summary: string;
  start: Date;
  location?: string;
  htmlLink?: string;
}

async function getOAuth2Client(user: User) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.BASE_URL}/auth/callback`
  );

  oauth2Client.setCredentials({
    access_token: user.access_token,
    refresh_token: user.refresh_token,
    expiry_date: user.token_expiry,
  });

  oauth2Client.on('tokens', (tokens) => {
    queries.updateUserTokens.run({
      id: user.id,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || null,
      token_expiry: tokens.expiry_date || null,
    });
    console.log(`[${user.email}] Tokens refreshed`);
  });

  return oauth2Client;
}

async function getUpcomingEvents(user: User): Promise<CalendarEvent[]> {
  try {
    const auth = await getOAuth2Client(user);
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 1 hour ahead

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events: CalendarEvent[] = [];
    for (const event of response.data.items || []) {
      const startTime = event.start?.dateTime || event.start?.date;
      if (!startTime || !event.id) continue;

      events.push({
        id: event.id,
        summary: event.summary || '(제목 없음)',
        start: new Date(startTime),
        location: event.location || undefined,
        htmlLink: event.htmlLink || undefined,
      });
    }

    return events;
  } catch (error: any) {
    console.error(`[${user.email}] Failed to fetch events:`, error.message);
    return [];
  }
}

async function sendDiscordNotification(
  webhookUrl: string,
  event: CalendarEvent,
  minutesUntil: number
): Promise<boolean> {
  try {
    const embed = {
      title: `📅 ${event.summary}`,
      color: 0x7c3aed,
      fields: [
        {
          name: '⏰ 시작 시간',
          value: event.start.toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            dateStyle: 'short',
            timeStyle: 'short',
          }),
          inline: true,
        },
        {
          name: '⏱️ 남은 시간',
          value: `${Math.round(minutesUntil)}분`,
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
    };

    if (event.location) {
      embed.fields.push({
        name: '📍 위치',
        value: event.location,
        inline: false,
      });
    }

    const body: any = {
      embeds: [embed],
    };

    if (event.htmlLink) {
      body.content = `[캘린더에서 보기](${event.htmlLink})`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      console.error(`Discord webhook failed: ${response.status}`);
      return false;
    }

    return true;
  } catch (error: any) {
    console.error(`Discord notification error:`, error.message);
    return false;
  }
}

async function processUser(user: User) {
  const events = await getUpcomingEvents(user);
  const now = Date.now();

  for (const event of events) {
    const eventStartMs = event.start.getTime();
    const minutesUntil = (eventStartMs - now) / (1000 * 60);

    if (minutesUntil <= 0 || minutesUntil > user.reminder_minutes) {
      continue;
    }

    const eventStartUnix = Math.floor(eventStartMs / 1000);
    const alreadyNotified = queries.isNotified.get(user.id, event.id, eventStartUnix);

    if (alreadyNotified) {
      continue;
    }

    console.log(`[${user.email}] Sending reminder for: ${event.summary}`);

    const success = await sendDiscordNotification(
      user.discord_webhook_url!,
      event,
      minutesUntil
    );

    if (success) {
      queries.insertNotified.run({
        user_id: user.id,
        event_id: event.id,
        event_start: eventStartUnix,
      });
      console.log(`[${user.email}] Notification sent successfully`);
    }
  }
}

async function checkAllUsers() {
  console.log(`[${new Date().toISOString()}] Checking calendars...`);

  const users = queries.getAllEnabledUsers.all() as User[];
  console.log(`Found ${users.length} enabled users`);

  for (const user of users) {
    try {
      await processUser(user);
    } catch (error: any) {
      console.error(`[${user.email}] Error:`, error.message);
    }
  }

  // Clean up old notifications (older than 24 hours)
  queries.cleanOldNotifications.run();
}

// Run immediately on start
checkAllUsers();

// Schedule to run every minute
const job = new CronJob('* * * * *', checkAllUsers);
job.start();

console.log('Worker started - checking calendars every minute');
