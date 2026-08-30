import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { getLedgerDatabaseOptions } from './ledger-database.options';

export default new DataSource(getLedgerDatabaseOptions());
