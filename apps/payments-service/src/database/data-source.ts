import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { getPaymentsDatabaseOptions } from './payments-database.options';

export default new DataSource(getPaymentsDatabaseOptions());
