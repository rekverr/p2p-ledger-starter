import { DataSourceOptions } from 'typeorm';
import { ActivityFeedItem } from './entities/activity-feed-item.entity';
import { ProcessedMessage } from './entities/processed-message.entity';
import { CreateNotificationsPersistence1725002000000 } from './migrations/1725002000000-CreateNotificationsPersistence';
import { IndexActivityFeedQueries1725002001000 } from './migrations/1725002001000-IndexActivityFeedQueries';

export const notificationsEntities = [ProcessedMessage, ActivityFeedItem];
export const notificationsMigrations = [
  CreateNotificationsPersistence1725002000000,
  IndexActivityFeedQueries1725002001000,
];

export function getNotificationsDatabaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: process.env.NOTIFICATIONS_DATABASE_HOST,
    port: Number(process.env.NOTIFICATIONS_DATABASE_PORT ?? 5432),
    username: process.env.NOTIFICATIONS_DATABASE_USER,
    password: process.env.NOTIFICATIONS_DATABASE_PASSWORD,
    database: process.env.NOTIFICATIONS_DATABASE_NAME,
    entities: notificationsEntities,
    migrations: notificationsMigrations,
    migrationsRun: true,
    synchronize: false,
  };
}
