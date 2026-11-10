import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PgBossService } from './pg-boss.service';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST ?? 'redis',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue({ name: 'default' }),
  ],
  providers: [PgBossService],
  exports: [PgBossService],
})
export class PgBossModule {}
