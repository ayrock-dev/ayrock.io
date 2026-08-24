import { definePrismaConfig } from '@prisma/cli-engine';
import { config } from 'dotenv';

config({ path: ['.env.local', '.env'] });

import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/lib/schema.prisma',
    db: {
      connection: process.env.DATABASE_URL,
    },
  }),
});
