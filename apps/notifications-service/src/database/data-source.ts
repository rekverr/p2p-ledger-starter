import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { getNotificationsDatabaseOptions } from './notifications-database.options';

export default new DataSource(getNotificationsDatabaseOptions());
