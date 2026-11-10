import * as fs from 'fs';

export const DocumentUtils = {
  needsWorkerProcessing(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["pptx", "ppt", "png", "jpg", "jpeg", "tiff", "gif", "webp"].includes(ext);
  },

  isDirectUpload(filename: string): boolean {
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    return ["pdf", "docx", "doc", "txt", "csv", "xlsx", "xls", "md", "markdown"].includes(ext);
  },

  safeDeleteFile(filePath: string): void {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.warn(`[Utils] Không thể xóa file ${filePath}:`, err.message);
      }
    }
  },

  safeDeleteFolder(dirPath: string): void {
    if (dirPath && fs.existsSync(dirPath)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[Utils] Không thể xóa thư mục ${dirPath}:`, err.message);
      }
    }
  }
};