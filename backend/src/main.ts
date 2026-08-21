import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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

  // setGlobalPrefix ne s'applique pas à SwaggerModule.setup : le préfixe doit
  // être répété explicitement dans le chemin de montage, sinon l'UI atterrit
  // sur /docs au lieu de /api/docs.
  const openApiDocument = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('DataShare API')
      .setDescription('Contrat OpenAPI généré depuis les DTO de validation.')
      .setVersion('0.0.1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, openApiDocument);

  // 0.0.0.0 et non localhost : sinon le serveur n'écoute que sur la boucle
  // locale du conteneur et nginx ne peut pas l'atteindre.
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
