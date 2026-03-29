import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";

import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { ReferenceMetadataDto } from "../dtos/reference-metadata.dto";
import { ReferenceMetadataService } from "../services/reference-metadata.service";

@ApiTags("Chat References")
@Controller("chat/references")
@ApiBearerAuth()
export class ReferenceController {
  constructor(private readonly referenceMetadataService: ReferenceMetadataService) {}

  @Get()
  @ApiOperation({ summary: "Resolve reference metadata by chunk ids" })
  @ApiQuery({ name: "chunkIds", required: true, description: "Comma-separated chunk ids" })
  async getReferences(
    @Query("chunkIds") chunkIdsParam: string,
  ): Promise<ReferenceMetadataDto[]> {
    const chunkIds = chunkIdsParam
      .split(",")
      .map(value => Number.parseInt(value.trim(), 10))
      .filter(value => Number.isFinite(value));

    return this.referenceMetadataService.getByChunkIds(chunkIds);
  }
}
