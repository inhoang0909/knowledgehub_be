import { Injectable } from "@nestjs/common";
import { DifyDatasetClientService } from "./services/dify-dataset-client.service";
import { DifyDocumentClientService } from "./services/dify-document-client.service";
import { DifySegmentClientService } from "./services/dify-segment-client.service";

/**
 * @class DifyClientService
 * @description Facade Service trung tâm đóng vai trò làm API Client Wrapper cho Dify Engine.
 * 
 * Mô hình kiến trúc:
 * Uỷ quyền nhiệm vụ giao tiếp HTTP cho 3 Client Sub-services chuyên biệt:
 * - `DifyDatasetClientService`: Thao tác trên Dataset (Tạo, xóa, xem danh sách document).
 * - `DifyDocumentClientService`: Thao tác trên Document Container (Upload file, Detail, Update status, Delete, Metadata).
 * - `DifySegmentClientService`: Thao tác trên Segments (Chunks, Q&A) & Search Retrieval Hit Testing.
 */
@Injectable()
export class DifyClientService {
  constructor(
    private readonly datasetClient: DifyDatasetClientService,
    private readonly documentClient: DifyDocumentClientService,
    private readonly segmentClient: DifySegmentClientService,
  ) {}

  // =================================================================
  // 1. DATASET OPERATIONS
  // =================================================================
  createDataset(name: string, description?: string) {
    return this.datasetClient.createDataset(name, description);
  }

  deleteDataset(difyDatasetId: string): Promise<boolean> {
    return this.datasetClient.deleteDataset(difyDatasetId);
  }

  getDocuments(
    difyDatasetId: string,
    page: number = 1,
    limit: number = 100,
    keyword: string = "",
  ) {
    return this.datasetClient.getDocuments(difyDatasetId, page, limit, keyword);
  }

  // =================================================================
  // 2. DOCUMENT CONTAINER OPERATIONS
  // =================================================================
  createContainerDocument(
    difyDatasetId: string,
    name: string,
    fileBuffer?: Buffer,
    originalFilename?: string,
    metadata?: Record<string, any>
  ) {
    return this.documentClient.createContainerDocument(
      difyDatasetId,
      name,
      fileBuffer,
      originalFilename,
      metadata,
    );
  }

  getDocumentDetail(difyDatasetId: string, difyDocumentId: string) {
    return this.documentClient.getDocumentDetail(difyDatasetId, difyDocumentId);
  }

  updateDocumentStatus(
    difyDatasetId: string,
    difyDocumentId: string,
    action: "enable" | "disable" | "archive",
  ) {
    return this.documentClient.updateDocumentStatus(difyDatasetId, difyDocumentId, action);
  }

  deleteDocument(difyDatasetId: string, difyDocumentId: string) {
    return this.documentClient.deleteDocument(difyDatasetId, difyDocumentId);
  }

  updateDocumentMetadata(difyDatasetId: string, difyDocumentId: string, metadata: Record<string, any>) {
    return this.documentClient.updateDocumentMetadata(difyDatasetId, difyDocumentId, metadata);
  }

  // =================================================================
  // 3. SEGMENT & RETRIEVAL OPERATIONS
  // =================================================================
  getSegments(
    difyDatasetId: string,
    difyDocumentId: string,
    keyword?: string,
  ) {
    return this.segmentClient.getSegments(difyDatasetId, difyDocumentId, keyword);
  }

  createSegment(
    difyDatasetId: string,
    difyDocumentId: string,
    text: string,
  ) {
    return this.segmentClient.createSegment(difyDatasetId, difyDocumentId, text);
  }

  createSegmentsBatch(
    difyDatasetId: string,
    difyDocumentId: string,
    items: Array<{ content: string; answer?: string; keywords?: string[] }>,
  ) {
    return this.segmentClient.createSegmentsBatch(difyDatasetId, difyDocumentId, items);
  }

  updateSegment(
    difyDatasetId: string,
    difyDocumentId: string,
    difySegmentId: string,
    text: string,
  ) {
    return this.segmentClient.updateSegment(difyDatasetId, difyDocumentId, difySegmentId, text);
  }

  deleteSegment(
    difyDatasetId: string,
    difyDocumentId: string,
    difySegmentId: string,
  ) {
    return this.segmentClient.deleteSegment(difyDatasetId, difyDocumentId, difySegmentId);
  }

  retrieveSegments(difyDatasetId: string, userQuery: string) {
    return this.segmentClient.retrieveSegments(difyDatasetId, userQuery);
  }
}
