import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Quan trọng: Để không phải import lại ở các module khác
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}