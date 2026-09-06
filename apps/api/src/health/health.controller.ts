import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Health check REST (non GraphQL): dev'essere raggiungibile anche quando
 * lo schema GraphQL non si costruisce, ed è quello che interrogano
 * docker compose e l'orchestratore.
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Liveness: il processo risponde. */
  @Get()
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Readiness: il database risponde davvero. */
  @Get('ready')
  async ready(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await this.prisma.ping();
    } catch (error) {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return { status: 'ok', database: 'up' };
  }
}
