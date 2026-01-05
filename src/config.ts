export const config = {
  port: process.env.PORT || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  basePath: process.env.BASE_PATH || '',
  sessionSecret: process.env.SESSION_SECRET || 'change-this-secret',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  databasePath: process.env.DATABASE_PATH || './data/calendar-reminder.db',
  reminderMinutes: parseInt(process.env.REMINDER_MINUTES || '10'),
};

export function withBasePath(path: string): string {
  return `${config.basePath}${path}`;
}
