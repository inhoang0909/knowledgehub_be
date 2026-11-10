import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ParsedResult {
  markdown: string;
  metadata?: any;    // Metadata object (no binary data)
}

@Injectable()
export class TxtParserService {
  private readonly logger = new Logger(TxtParserService.name);

  /**
   * Parse TXT file and convert to markdown
   * @param filePath - Path to the TXT file
   * @returns Parsed result with markdown content
   */
  async parseTxtToMarkdown(filePath: string): Promise<ParsedResult> {
    try {
      const fileName = path.basename(filePath, '.txt');
      const content = await fs.readFile(filePath, 'utf-8');

      // Convert plain text to markdown with proper formatting
      let markdown = `# ${fileName}\n\n`;
      
      // Split content into paragraphs
      const paragraphs = content.split(/\n\s*\n/);
      
      paragraphs.forEach(paragraph => {
        const trimmed = paragraph.trim();
        if (trimmed) {
          // Check if it looks like a heading (short line, maybe all caps or numbered)
          if (trimmed.length < 100 && (
            /^[A-Z\s]+$/.test(trimmed) || 
            /^\d+\./.test(trimmed) ||
            /^[IVX]+\./.test(trimmed)
          )) {
            markdown += `## ${trimmed}\n\n`;
          } else {
            markdown += `${trimmed}\n\n`;
          }
        }
      });

      return {
        markdown,
        metadata: {
          originalFile: filePath,
          lineCount: content.split('\n').length,
          characterCount: content.length,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to parse TXT: ${filePath}`, error);
      throw new Error(`TXT parsing failed: ${error.message}`);
    }
  }
}
