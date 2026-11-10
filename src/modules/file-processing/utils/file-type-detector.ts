import * as fs from 'fs/promises';

/**
 * File type detection based on magic numbers (file signatures)
 * This is more reliable than relying on file extensions
 */
export class FileTypeDetector {
  /**
   * Detect file type by reading the first few bytes (magic numbers)
   */
  static async detectFileType(filePath: string): Promise<string | null> {
    try {
      const buffer = await fs.readFile(filePath);
      
      // Check for PDF signature (%PDF-)
      if (buffer.length >= 5 && buffer.toString('utf-8', 0, 5) === '%PDF-') {
        return 'pdf';
      }

      // Check for PNG signature (89 50 4E 47 0D 0A 1A 0A)
      if (buffer.length >= 8 &&
          buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
          buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
        return 'png';
      }

      // Check for JPEG (FF D8 FF)
      if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'jpeg';
      }

      // Check for GIF (GIF87a or GIF89a)
      if (buffer.length >= 6 &&
          (buffer.toString('utf-8', 0, 6) === 'GIF87a' || buffer.toString('utf-8', 0, 6) === 'GIF89a')) {
        return 'gif';
      }

      // Check for TIFF (II*\0 or MM\0*)
      if (buffer.length >= 4) {
        if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) {
          return 'tiff';
        }
        if (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A) {
          return 'tiff';
        }
      }

      // Check for WEBP (RIFF....WEBP)
      if (buffer.length >= 12 && buffer.toString('utf-8', 0, 4) === 'RIFF' && buffer.toString('utf-8', 8, 12) === 'WEBP') {
        return 'webp';
      }
      
      // Check for Excel XLSX (ZIP signature: PK followed by specific internal structure)
      if (buffer.length >= 4 && 
          buffer[0] === 0x50 && buffer[1] === 0x4B && 
          buffer[2] === 0x03 && buffer[3] === 0x04) {
        // Further check if it's specifically an Excel file
        const content = buffer.toString('utf-8');
        if (content.includes('xl/workbook.xml') || content.includes('xl/')) {
          return 'xlsx';
        }
        // Check for PowerPoint PPTX
        if (content.includes('ppt/presentation.xml') || content.includes('ppt/')) {
          return 'pptx';
        }
        // Check for Word DOCX
        if (content.includes('word/document.xml') || content.includes('word/')) {
          return 'docx';
        }
      }
      
      // Check for old Excel XLS (OLE signature: D0 CF 11 E0 A1 B1 1A E1)
      if (buffer.length >= 8 &&
          buffer[0] === 0xD0 && buffer[1] === 0xCF &&
          buffer[2] === 0x11 && buffer[3] === 0xE0 &&
          buffer[4] === 0xA1 && buffer[5] === 0xB1 &&
          buffer[6] === 0x1A && buffer[7] === 0xE1) {
        // Need to check if it's XLS, DOC, or PPT
        const content = buffer.toString('utf-8');
        // Check for Word doc signature
        if (content.includes('Microsoft Word') || content.includes('Word.Document')) {
          return 'doc';
        }
        // Check for PowerPoint ppt signature
        if (content.includes('Microsoft PowerPoint') || content.includes('PowerPoint')) {
          return 'ppt';
        }
        // Default to XLS
        return 'xls';
      }
      
      // Check if file is likely plain text (no control characters in first 512 bytes)
      const sample = buffer.slice(0, Math.min(512, buffer.length));
      if (this.isLikelyText(sample)) {
        return 'txt';
      }
      
      // Check for CSV (plain text with comma/semicolon patterns)
      if (this.isLikelyCsv(sample)) {
        return 'csv';
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Check if buffer contains mostly printable text
   */
  private static isLikelyText(buffer: Buffer): boolean {
    let textChars = 0;
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      // Count printable ASCII, newlines, tabs, and common UTF-8 sequences
      if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13 || byte >= 128) {
        textChars++;
      }
    }
    // If more than 90% are text-like characters, consider it text
    return (textChars / buffer.length) > 0.9;
  }
  
  /**
   * Check if buffer looks like CSV (text with comma/semicolon patterns)
   */
  private static isLikelyCsv(buffer: Buffer): boolean {
    if (!this.isLikelyText(buffer)) {
      return false;
    }
    
    const text = buffer.toString('utf-8', 0, Math.min(1024, buffer.length));
    const lines = text.split('\n').slice(0, 10); // Check first 10 lines
    
    if (lines.length < 2) {
      return false;
    }
    
    // Check if lines have consistent comma or semicolon counts
    const commaCount = lines[0].split(',').length - 1;
    const semicolonCount = lines[0].split(';').length - 1;
    const delimiter = commaCount > semicolonCount ? ',' : ';';
    const delimiterCount = Math.max(commaCount, semicolonCount);
    
    if (delimiterCount < 1) {
      return false;
    }
    
    // Check if at least 80% of lines have similar delimiter count
    let matchingLines = 0;
    for (const line of lines) {
      const count = line.split(delimiter).length - 1;
      if (Math.abs(count - delimiterCount) <= 1) {
        matchingLines++;
      }
    }
    
    return (matchingLines / lines.length) >= 0.8;
  }
  
  /**
   * Verify if detected type matches expected type from extension
   * Returns true if they match, false if there's a mismatch
   */
  static typesMatch(detectedType: string | null, expectedType: string): boolean {
    if (!detectedType) {
      return true; // Can't verify, assume it's OK
    }
    
    // Normalize types
    const normalized = expectedType.toLowerCase().replace('.', '');
    const detected = detectedType.toLowerCase();
    
    // Handle CSV/TXT ambiguity (both are text files)
    if ((normalized === 'csv' || normalized === 'txt') && 
        (detected === 'csv' || detected === 'txt')) {
      return true;
    }
    
    // Handle DOCX/DOC ambiguity
    if ((normalized === 'docx' || normalized === 'doc') && 
        (detected === 'docx' || detected === 'doc')) {
      return true;
    }
    
    // Handle PPTX/PPT ambiguity
    if ((normalized === 'pptx' || normalized === 'ppt') && 
        (detected === 'pptx' || detected === 'ppt')) {
      return true;
    }
    
    return normalized === detected;
  }
}
