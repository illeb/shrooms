import { Module } from '@nestjs/common';
import { MycologyService } from './mycology.service';
import { SpeciesModelService } from './species-model.service';
import { ForestCellResolver } from './graphql/forest-cell.resolver';
import { ForestPatchResolver } from './graphql/forest-patch.resolver';
import { PredictionResolver } from './graphql/prediction.resolver';

/**
 * Il dominio micologico: profili di specie, feature store, punteggi.
 *
 * Tutta la matematica vive in @mushrooms/mycology-core; qui c'e' solo la
 * colla verso il database.
 */
@Module({
  providers: [
    SpeciesModelService,
    MycologyService,
    PredictionResolver,
    ForestCellResolver,
    ForestPatchResolver,
  ],
  exports: [SpeciesModelService, MycologyService],
})
export class MycologyModule {}
