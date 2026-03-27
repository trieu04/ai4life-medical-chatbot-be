export interface ReferenceHeadingDto {
  sectionId: number;
  heading: string;
  sectionPath: string | null;
  startPage: number | null;
  level: number | null;
}

export interface ReferenceMetadataDto {
  chunkId: number;
  guidelineId?: number;
  guidelineTitle?: string;
  versionId?: number;
  versionLabel?: string;
  sectionId?: number;
  headings: ReferenceHeadingDto[];
  deepestHeading?: string;
  sectionPath?: string;
  startPage?: number;
  documentId?: number;
  pdfPage?: number;
}
