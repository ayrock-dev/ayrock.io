#!/usr/bin/env -S node
import postgres_serverless from '@prisma/orm-postgres/serverless';
import {
  Migration,
  MigrationCLI,
  col,
  fn,
  primaryKey,
} from '@prisma/orm-postgres/migration';
import type { Contract as Start } from '../../snapshots/44a0c79b03b7cc0cf8f2467fbe10154fbf1c9d060e29c67964e2325949e464f0/contract';
import startContract from '../../snapshots/44a0c79b03b7cc0cf8f2467fbe10154fbf1c9d060e29c67964e2325949e464f0/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/49c54fe87964a5bd97f36198768b2c3039c19e9fda39f6e6d7f3bc4989a553b6/contract';
import endContract from '../../snapshots/49c54fe87964a5bd97f36198768b2c3039c19e9fda39f6e6d7f3bc4989a553b6/contract.json' with { type: 'json' };

const DEFAULT_USER_ID = 'jwrcxkb0v5';
const NOW = new Date('2026-08-24T00:00:00.000Z');
const schema = 'public';
const user = 'ayrock.busy.user';
const device = 'ayrock.busy.device';
const connection = 'ayrock.busy.connection';

const db = postgres_serverless({ contractJson: endContract }).sql;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    const D = db[schema][device];
    const C = db[schema][connection];
    const U = db[schema][user];
    return [
      this.createTable({
        schema,
        table: user,
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
      this.addColumn({
        schema,
        table: device,
        column: col('accessToken', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema,
        table: device,
        column: col('expiresAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz@1' },
        }),
      }),
      this.addColumn({
        schema,
        table: device,
        column: col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema,
        table: connection,
        column: col('userId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dataTransform(this.endContract, 'seed-user-and-migrate-connections', {
        run: [
          () => U.insert([{ id: DEFAULT_USER_ID, updated_at: NOW }]).build(),
          () =>
            D.update((_f, fns) => ({
              accessToken: fns.raw`(SELECT c."accessToken" FROM "public"."ayrock.busy.connection" c WHERE c."deviceId" = "public"."ayrock.busy.device"."id" AND c."type" = 'busybar' LIMIT 1)`.returns(
                { codecId: 'pg/text@1', nullable: true },
              ),
              expiresAt: fns.raw`(SELECT c."expiresAt" FROM "public"."ayrock.busy.connection" c WHERE c."deviceId" = "public"."ayrock.busy.device"."id" AND c."type" = 'busybar' LIMIT 1)`.returns(
                { codecId: 'pg/timestamptz@1', nullable: true },
              ),
              updated_at: fns.raw`TIMESTAMPTZ '2026-08-24T00:00:00.000Z'`.returns(
                { codecId: 'pg/timestamptz@1', nullable: false },
              ),
            })).build(),
          () => C.update({ userId: DEFAULT_USER_ID, updated_at: NOW }).build(),
          () => D.update({ userId: DEFAULT_USER_ID, updated_at: NOW }).build(),
          () => C.delete().where((f, fns) => fns.eq(f.type, 'busybar')).build(),
          () =>
            C.delete().where(
              (_f, fns) =>
                fns.raw`"public"."ayrock.busy.connection"."id" NOT IN (SELECT DISTINCT ON ("userId", "type") "id" FROM "public"."ayrock.busy.connection" ORDER BY "userId", "type", "created_at" DESC)`.returns(
                  { codecId: 'pg/bool@1', nullable: false },
                ),
            ).build(),
        ],
      }),
      this.setNotNull({ schema, table: connection, column: 'userId' }),
      this.setNotNull({ schema, table: device, column: 'userId' }),
      this.dropConstraint({
        schema,
        table: connection,
        constraint: 'ayrock.busy.connection_deviceId_fkey',
        kind: 'foreignKey',
      }),
      this.dropIndex({
        schema,
        table: connection,
        index: 'ayrock.busy.connection_deviceId_idx_a7d461e8',
      }),
      this.dropConstraint({
        schema,
        table: connection,
        constraint: 'ayrock.busy.connection_deviceId_type_key',
      }),
      this.dropColumn({ schema, table: connection, column: 'deviceId' }),
      this.addUnique({
        schema,
        table: connection,
        constraint: 'ayrock.busy.connection_userId_type_key',
        columns: ['userId', 'type'],
      }),
      this.createIndex({
        schema,
        table: connection,
        index: 'ayrock.busy.connection_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.createIndex({
        schema,
        table: device,
        index: 'ayrock.busy.device_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema,
        table: connection,
        foreignKey: {
          name: 'ayrock.busy.connection_userId_fkey',
          columns: ['userId'],
          references: { schema, table: user, columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema,
        table: device,
        foreignKey: {
          name: 'ayrock.busy.device_userId_fkey',
          columns: ['userId'],
          references: { schema, table: user, columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
