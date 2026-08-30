#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/3e3352a18cd76e1634c61f818eaa10ab39fa8104b133f500f56eae14f20f61d9/contract';
import endContract from '../../snapshots/3e3352a18cd76e1634c61f818eaa10ab39fa8104b133f500f56eae14f20f61d9/contract.json' with { type: 'json' };
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
          col('access_token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('event_id', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('expires_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('next_event_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
          col('refresh_token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('type', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'ayrock.busy.device',
        columns: [
          col('access_token', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('expires_at', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('updated_at', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('user_id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'ayrock.busy.user',
        columns: [
          col('created_at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
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
        constraint: 'ayrock.busy.connection_user_id_type_key',
        columns: ['user_id', 'type'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ayrock.busy.connection',
        index: 'ayrock.busy.connection_user_id_idx_6c952402',
        columns: ['user_id'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'ayrock.busy.device',
        index: 'ayrock.busy.device_user_id_idx_6c952402',
        columns: ['user_id'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ayrock.busy.connection',
        foreignKey: {
          name: 'ayrock.busy.connection_user_id_fkey',
          columns: ['user_id'],
          references: { schema: 'public', table: 'ayrock.busy.user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'ayrock.busy.device',
        foreignKey: {
          name: 'ayrock.busy.device_user_id_fkey',
          columns: ['user_id'],
          references: { schema: 'public', table: 'ayrock.busy.user', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
