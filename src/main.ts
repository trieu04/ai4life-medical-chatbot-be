import "./configs/vars";

import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { useContainer } from "class-validator";
import * as cookieParser from "cookie-parser";
import { AppModule } from "./app.module";
import { configSwagger } from "./configs/swagger";
import { QueryFailedErrorFilter } from "./common/filters/query-failed-error.filter";
import { configCORS } from "./configs/cors";

declare const module: any;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.setGlobalPrefix("api");

  const logger = new Logger("Bootstrap");

  configCORS(app);

  // Get the port from the config
  const configService = app.get<ConfigService>(ConfigService);
  const port = configService.getOrThrow<number>("app.port");

  // Trust proxy headers (for Cloudflare Tunnel, Nginx, etc.)
  app.set("trust proxy", true);

  // Enable cookie parser
  app.use(cookieParser());

  // Validation
  useContainer(app.select(AppModule), { fallbackOnErrors: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Exception Filters
  app.useGlobalFilters(new QueryFailedErrorFilter());

  // Config Swagger
  configSwagger(app);

  // Start the app
  await app.listen(port, () => {
    logger.log(`Server is running on port ${port}`);
  });

  // Hot Module Replacement
  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}

bootstrap();
