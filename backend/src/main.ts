import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Validation globale. `whitelist` retire les propriétés non déclarées dans le
  // DTO, `forbidNonWhitelisted` renvoie une 400 si le client en envoie : le
  // client ne peut pas glisser un champ que le serveur ignorerait
  // silencieusement. `transform` applique les types déclarés.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Le préfixe est repris par nginx, qui proxifie /api vers ce service.
  app.setGlobalPrefix('api');

  // 0.0.0.0 et non localhost : sinon le serveur n'écoute que sur la boucle
  // locale du conteneur et nginx ne peut pas l'atteindre.
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
