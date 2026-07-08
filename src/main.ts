import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import {
  getAllowedCorsHostnamePatterns,
  getAllowedCorsOriginSuffixes,
  getAllowedCorsOrigins,
  isAllowedCorsOrigin,
} from './common/cors';
import { HttpExceptionFilter } from './common/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const allowedOrigins = getAllowedCorsOrigins();
  const allowedOriginSuffixes = getAllowedCorsOriginSuffixes();
  const allowedHostnamePatterns = getAllowedCorsHostnamePatterns();

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (
      typeof origin === 'string' &&
      isAllowedCorsOrigin(origin, allowedOrigins, allowedOriginSuffixes, allowedHostnamePatterns)
    ) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
      res.header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
      res.header(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || 'Content-Type,Authorization',
      );
    }

    if (req.method === 'OPTIONS') {
      res.status(204).send();
      return;
    }

    next();
  });

  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    origin(origin, callback) {
      if (isAllowedCorsOrigin(origin, allowedOrigins, allowedOriginSuffixes, allowedHostnamePatterns)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  });

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
