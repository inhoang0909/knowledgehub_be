import { Module } from '@nestjs/common';
import { CategoriesService } from './services/categories.service';
import { CategoriesController } from './categories.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { CategoryTreeService } from './services/category-tree.service';
import { CategoryValidationService } from './services/category-validation.service';
import { SemanticRouterService } from './services/semantic-router.service';
import { CategoryDatasetService } from './services/category-dataset.service';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    PrismaModule, 
    HttpModule,
    ConfigModule.forRoot()
  ],
  controllers: [CategoriesController],
  providers: [
    CategoriesService,
    CategoryValidationService,
    CategoryTreeService,
    CategoryDatasetService,
    SemanticRouterService,
  ],
  exports: [CategoriesService],
})
export class CategoriesModule {}
