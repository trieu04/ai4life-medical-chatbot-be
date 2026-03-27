jest.mock("../../auth/guards/jwt-auth.guard", () => ({
  JwtAuthGuard: class JwtAuthGuardMock {},
}));

import { ReferenceController } from "./reference.controller";

describe("ReferenceController", () => {
  it("parses comma-separated chunk ids and forwards them to the service", async () => {
    const referenceMetadataService = {
      getByChunkIds: jest.fn().mockResolvedValue([]),
    };

    const controller = new ReferenceController(referenceMetadataService as any);

    await controller.getReferences("1, 2, 3");

    expect(referenceMetadataService.getByChunkIds).toHaveBeenCalledWith([1, 2, 3]);
  });
});
