import { Controller, Get } from '@nestjs/common';

/**
 * Sonde de vivacité (liveness).
 *
 * Répond dès que le processus Node est capable de servir une requête. C'est ce
 * dont `docker compose` a besoin pour savoir si le conteneur est démarré, et
 * rien de plus.
 *
 *   [compose healthcheck] ──GET /health──> [API] ──> 200 { status: 'ok' }
 *
 * Ce n'est PAS une sonde de disponibilité (readiness) : elle ne vérifie ni
 * PostgreSQL, ni Redis, ni MinIO. Une sonde de disponibilité viendra quand ces
 * clients existeront (Prisma arrive avec SOC-04), sur une route distincte
 * `/health/ready`, parce que les deux répondent à des questions différentes :
 *
 *   liveness  : « faut-il redémarrer ce conteneur ? »
 *   readiness : « faut-il lui envoyer du trafic ? »
 *
 * Les confondre est le piège classique : une base momentanément indisponible
 * ferait redémarrer l'API en boucle alors qu'elle n'a rien à se reprocher.
 */
@Controller('health')
export class HealthController {
  @Get()
  liveness() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
