import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HttpExceptionFilter } from '@common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // 2. Cấu hình Swagger
  const config = new DocumentBuilder()
    .setTitle('Dify Wrapper API')
    .setDescription('API documentation for Dify Contribution & Approval System')
    .setVersion('1.0')
    .addBearerAuth() // Nếu sau này cần nút nhập Token
    .build();

  const document = SwaggerModule.createDocument(app, config);
  
  // 3. Dựng Swagger tại đường dẫn /api
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ? +process.env.PORT : 9000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`🚀 Swagger is running on: http://${displayHost}:${port}/api`);
}
bootstrap();