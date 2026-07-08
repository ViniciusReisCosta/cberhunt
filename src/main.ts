import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getAllowedCorsOriginSuffixes, getAllowedCorsOrigins, isAllowedCorsOrigin } from './common/cors';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const allowedOrigins = getAllowedCorsOrigins();
  const allowedOriginSuffixes = getAllowedCorsOriginSuffixes();

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin, allowedOrigins, allowedOriginSuffixes)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
