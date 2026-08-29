#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/49c54fe87964a5bd97f36198768b2c3039c19e9fda39f6e6d7f3bc4989a553b6/contract';
import startContract from '../../snapshots/49c54fe87964a5bd97f36198768b2c3039c19e9fda39f6e6d7f3bc4989a553b6/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/9188c524a7c0d11e8e31a79bb3423f7fce19285204df76e06a347033ff3a39e4/contract';
import endContract from '../../snapshots/9188c524a7c0d11e8e31a79bb3423f7fce19285204df76e06a347033ff3a39e4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'ayrock.busy.connection',
        column: col('eventId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'ayrock.busy.connection',
        column: col('nextEventAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
