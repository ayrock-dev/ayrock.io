#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/44a0c79b03b7cc0cf8f2467fbe10154fbf1c9d060e29c67964e2325949e464f0/contract';
import endContract from '../../snapshots/44a0c79b03b7cc0cf8f2467fbe10154fbf1c9d060e29c67964e2325949e464f0/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createSchema({ schema: 'public' }),
      this.createTable({
        schema: 'public',
        table: 'ayrock.busy.connection',
        columns: [
          col('accessToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('deviceId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('expiresAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refreshToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'ayrock.busy.device',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'ayrock.busy.connection',
        constraint: 'ayrock.busy.connection_deviceId_type_key',
        columns: ['deviceId', 'type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ayrock.busy.connection',
        index: 'ayrock.busy.connection_deviceId_idx_a7d461e8',
        columns: ['deviceId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ayrock.busy.connection',
        foreignKey: {
          name: 'ayrock.busy.connection_deviceId_fkey',
          columns: ['deviceId'],
          references: { schema: 'public', table: 'ayrock.busy.device', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
