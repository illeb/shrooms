import { Module } from '@nestjs/common';
import { MycologyService } from './mycology.service';
import { SpeciesModelService } from './species-model.service';
import { PredictionResolver } from './graphql/prediction.resolver';

/**
 * Il dominio micologico: profili di specie, feature store, punteggi.
 *
 * Tutta la matematica vive in @mushrooms/mycology-core; qui c'e' solo la
 * colla verso il database.
 */
@Module({
  providers: [SpeciesModelService, MycologyService, PredictionResolver],
  exports: [SpeciesModelService, MycologyService],
})
export class MycologyModule {}
