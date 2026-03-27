import { ReferenceMetadataService } from "./reference-metadata.service";

describe("ReferenceMetadataService", () => {
  it("resolves chunk ids through sections, versions, and guidelines", async () => {
    const cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const secondaryDataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([
          {
            chunk_id: 123,
            section_id: 30,
            version_id: 7,
          },
        ])
        .mockResolvedValueOnce([
          {
            section_id: 30,
            heading: "Leaf",
            section_path: "1.2",
            page_start: 12,
            level: 2,
            parent_id: 20,
            version_id: 7,
          },
          {
            section_id: 20,
            heading: "Root",
            section_path: "1",
            page_start: 10,
            level: 1,
            parent_id: null,
            version_id: 7,
          },
        ])
        .mockResolvedValueOnce([
          {
            version_id: 7,
            version_label: "v1",
            guideline_id: 9,
            guideline_title: "Guideline title",
            document_id: 55,
          },
        ]),
    };

    const service = new ReferenceMetadataService(
      cacheManager as any,
      secondaryDataSource as any,
    );

    await expect(service.getByChunkIds([123])).resolves.toEqual([
      {
        chunkId: 123,
        guidelineId: 9,
        guidelineTitle: "Guideline title",
        versionId: 7,
        versionLabel: "v1",
        sectionId: 30,
        headings: [
          {
            sectionId: 20,
            heading: "Root",
            sectionPath: "1",
            startPage: 10,
            level: 1,
          },
          {
            sectionId: 30,
            heading: "Leaf",
            sectionPath: "1.2",
            startPage: 12,
            level: 2,
          },
        ],
        deepestHeading: "Leaf",
        sectionPath: "1.2",
        startPage: 12,
        documentId: 55,
        pdfPage: 12,
      },
    ]);

    expect(secondaryDataSource.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("left join public.documents d on d.version_id = gv.version_id"),
      [[7]],
    );
    expect(secondaryDataSource.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("d.document_id"),
      [[7]],
    );
  });

  it("falls back to startPage when pdfPage mapping is absent", async () => {
    const cacheManager = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockResolvedValue(undefined),
    };

    const secondaryDataSource = {
      query: jest.fn()
        .mockResolvedValueOnce([
          {
            chunk_id: 101,
            section_id: 40,
            version_id: 8,
          },
        ])
        .mockResolvedValueOnce([
          {
            section_id: 40,
            heading: "Only section",
            section_path: "2.1",
            page_start: 14,
            level: 1,
            parent_id: null,
            version_id: 8,
          },
        ])
        .mockResolvedValueOnce([
          {
            version_id: 8,
            version_label: "v2",
            guideline_id: 12,
            guideline_title: "Another guideline",
            document_id: 88,
          },
        ]),
    };

    const service = new ReferenceMetadataService(
      cacheManager as any,
      secondaryDataSource as any,
    );

    const [reference] = await service.getByChunkIds([101]);

    expect(reference.pdfPage).toBe(reference.startPage);
  });
});
