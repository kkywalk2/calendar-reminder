import 'dotenv/config';
import { CronJob } from 'cron';
import { google } from 'googleapis';
import { queries, User } from './db';

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

async function getDailyEvents(user: User): Promise<CalendarEvent[]> {
  try {
    const auth = await getOAuth2Client(user);
    const calendar = google.calendar({ version: 'v3', auth });

    // 한국 시간 기준 오늘 시작과 끝
    const now = new Date();
    const koreaOffset = 9 * 60 * 60 * 1000; // UTC+9
    const koreaTime = new Date(now.getTime() + koreaOffset);

    // 한국 시간 기준 오늘 00:00:00
    const todayStart = new Date(Date.UTC(
      koreaTime.getUTCFullYear(),
      koreaTime.getUTCMonth(),
      koreaTime.getUTCDate(),
      0, 0, 0
    ));
    todayStart.setTime(todayStart.getTime() - koreaOffset);

    // 한국 시간 기준 오늘 23:59:59
    const todayEnd = new Date(Date.UTC(
      koreaTime.getUTCFullYear(),
      koreaTime.getUTCMonth(),
      koreaTime.getUTCDate(),
      23, 59, 59
    ));
    todayEnd.setTime(todayEnd.getTime() - koreaOffset);

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: todayStart.toISOString(),
      timeMax: todayEnd.toISOString(),
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
    console.error(`[${user.email}] Failed to fetch daily events:`, error.message);
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

async function sendDailySummary(
  webhookUrl: string,
  events: CalendarEvent[],
  userEmail: string
): Promise<boolean> {
  try {
    const today = new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

    let description: string;
    if (events.length === 0) {
      description = '오늘은 예정된 일정이 없습니다.';
    } else {
      description = events
        .map((event, index) => {
          const time = event.start.toLocaleTimeString('ko-KR', {
            timeZone: 'Asia/Seoul',
            hour: '2-digit',
            minute: '2-digit',
          });
          const location = event.location ? ` (${event.location})` : '';
          return `${index + 1}. **${time}** - ${event.summary}${location}`;
        })
        .join('\n');
    }

    const embed = {
      title: `📋 오늘의 일정 - ${today}`,
      description,
      color: 0x4ade80,
      fields: [
        {
          name: '총 일정',
          value: `${events.length}개`,
          inline: true,
        },
      ],
      timestamp: new Date().toISOString(),
      footer: {
        text: userEmail,
      },
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });

    if (!response.ok) {
      console.error(`Discord daily summary webhook failed: ${response.status}`);
      return false;
    }

    return true;
  } catch (error: any) {
    console.error(`Discord daily summary error:`, error.message);
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

async function sendDailySummaryToAllUsers() {
  console.log(`[${new Date().toISOString()}] Sending daily summary...`);

  const users = queries.getAllEnabledUsers.all() as User[];
  console.log(`Found ${users.length} enabled users for daily summary`);

  for (const user of users) {
    if (!user.discord_webhook_url) continue;

    try {
      const events = await getDailyEvents(user);
      const success = await sendDailySummary(
        user.discord_webhook_url,
        events,
        user.email
      );

      if (success) {
        console.log(`[${user.email}] Daily summary sent (${events.length} events)`);
      }
    } catch (error: any) {
      console.error(`[${user.email}] Daily summary error:`, error.message);
    }
  }
}

// Run immediately on start
checkAllUsers();

// Schedule to run every minute for reminders
const reminderJob = new CronJob('* * * * *', checkAllUsers);
reminderJob.start();

// Schedule daily summary at 9:00 AM Korea time
const dailySummaryJob = new CronJob(
  '0 9 * * *',
  sendDailySummaryToAllUsers,
  null,
  true,
  'Asia/Seoul'
);
dailySummaryJob.start();

console.log('Worker started - checking calendars every minute');
console.log('Daily summary scheduled at 9:00 AM KST');
