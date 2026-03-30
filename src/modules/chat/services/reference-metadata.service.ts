import { Inject, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";

import { RAG_DATA_SOURCE } from "../rag-data-source.module";
import { ReferenceMetadataDto } from "../dtos/reference-metadata.dto";

interface ChunkRow {
  chunk_id: number;
  section_id: number | null;
  version_id: number | null;
}

interface SectionRow {
  section_id: number;
  heading: string | null;
  section_path: string | null;
  page_start: number | null;
  level: number | null;
  parent_id: number | null;
  version_id: number | null;
}

interface VersionRow {
  version_id: number;
  version_label: string | null;
  guideline_id: number | null;
  guideline_title: string | null;
  document_id: number | null;
}

@Injectable()
export class ReferenceMetadataService {
  constructor(
    @Inject(RAG_DATA_SOURCE) private readonly ragDataSource: DataSource,
  ) {}

  async getByChunkIds(chunkIds: number[]): Promise<ReferenceMetadataDto[]> {
    const uniqueChunkIds = [...new Set(chunkIds)];
    const resolved = await this.resolveMissingChunkIds(uniqueChunkIds);
    const results = new Map(resolved.map(item => [String(item.chunkId), item]));

    return uniqueChunkIds.flatMap((chunkId) => {
      const item = results.get(String(chunkId));
      return item ? [item] : [];
    });
  }

  private async resolveMissingChunkIds(chunkIds: number[]): Promise<ReferenceMetadataDto[]> {
    const chunkRows = await this.ragDataSource.query(
      `
        select chunk_id, section_id, version_id
        from public.chunks
        where chunk_id = any($1)
      `,
      [chunkIds],
    ) as ChunkRow[];

    if (chunkRows.length === 0) {
      return [];
    }

    const sectionIds = [...new Set(chunkRows.flatMap(row => row.section_id ? [row.section_id] : []))];
    const sectionRows = sectionIds.length === 0
      ? []
      : await this.ragDataSource.query(
          `
            with recursive section_tree as (
              select section_id, heading, section_path, page_start, level, parent_id, version_id
              from public.sections
              where section_id = any($1)
              union
              select s.section_id, s.heading, s.section_path, s.page_start, s.level, s.parent_id, s.version_id
              from public.sections s
              inner join section_tree st on st.parent_id = s.section_id
            )
            select distinct section_id, heading, section_path, page_start, level, parent_id, version_id
            from section_tree
          `,
          [sectionIds],
        ) as SectionRow[];

    const versionIds = [...new Set(chunkRows.flatMap(row => row.version_id ? [row.version_id] : []))];
    const versionRows = versionIds.length === 0
      ? []
      : await this.ragDataSource.query(
          `
            select gv.version_id, gv.version_label, gv.guideline_id, g.title as guideline_title, d.document_id as document_id
            from public.guideline_versions gv
            left join public.guidelines g on g.guideline_id = gv.guideline_id
            left join public.documents d on d.version_id = gv.version_id
            where gv.version_id = any($1)
          `,
          [versionIds],
        ) as VersionRow[];

    const sectionsById = new Map(sectionRows.map(row => [row.section_id, row]));
    const versionsById = new Map(versionRows.map(row => [row.version_id, row]));

    return chunkRows.map((chunkRow) => {
      const headings = this.buildHeadingTrail(chunkRow.section_id, sectionsById);
      const version = chunkRow.version_id ? versionsById.get(chunkRow.version_id) : undefined;
      const deepestHeading = headings.at(-1);
      const startPage = deepestHeading?.startPage ?? undefined;

      return {
        chunkId: chunkRow.chunk_id,
        guidelineId: version?.guideline_id ?? undefined,
        guidelineTitle: version?.guideline_title ?? undefined,
        versionId: chunkRow.version_id ?? undefined,
        versionLabel: version?.version_label ?? undefined,
        sectionId: chunkRow.section_id ?? undefined,
        headings,
        deepestHeading: deepestHeading?.heading,
        sectionPath: deepestHeading?.sectionPath ?? undefined,
        startPage,
        documentId: version?.document_id ?? undefined,
        pdfPage: startPage,
      };
    });
  }

  private buildHeadingTrail(
    sectionId: number | null,
    sectionsById: Map<number, SectionRow>,
  ): ReferenceMetadataDto["headings"] {
    if (!sectionId) {
      return [];
    }

    const trail: ReferenceMetadataDto["headings"] = [];
    const visited = new Set<number>();
    let currentSectionId: number | null = sectionId;

    while (currentSectionId && !visited.has(currentSectionId)) {
      visited.add(currentSectionId);
      const row = sectionsById.get(currentSectionId);
      if (!row) {
        break;
      }

      trail.unshift({
        sectionId: row.section_id,
        heading: row.heading ?? "Untitled section",
        sectionPath: row.section_path,
        startPage: row.page_start,
        level: row.level,
      });

      currentSectionId = row.parent_id;
    }

    return trail;
  }
}
