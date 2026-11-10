import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

export interface ParsedResult {
  markdown: string;
  metadata?: any;    // Metadata object (no binary data)
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  /**
   * Parse CSV file and convert to markdown
   * @param filePath - Path to the CSV file
   * @returns Parsed result with markdown content
   */
  async parseCsvToMarkdown(filePath: string): Promise<ParsedResult> {
    try {
      const fileName = path.basename(filePath);
      const content = await fs.readFile(filePath, 'utf-8');

      // Parse CSV
      const records = parse(content, {
        columns: false,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true, // Allow rows with different column counts
      });

      let markdown = `# ${fileName}\n\n`;

      if (records.length === 0) {
        markdown += '*Empty CSV file*\n\n';
        return {
          markdown,
          metadata: {
            originalFile: filePath,
            rowCount: 0,
          },
        };
      }

      // Create markdown table
      markdown += this.createMarkdownTable(records);

      return {
        markdown,
        metadata: {
          originalFile: filePath,
          rowCount: records.length,
          columnCount: records[0]?.length || 0,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to parse CSV: ${filePath}`, error);
      throw new Error(`CSV parsing failed: ${error.message}`);
    }
  }

  /**
   * Create a markdown table from 2D array
   */
  private createMarkdownTable(data: string[][]): string {
    if (data.length === 0) return '';

    const headers = data[0];
    const rows = data.slice(1);

    // Create header row
    let table = '| ' + headers.join(' | ') + ' |\n';
    
    // Create separator row
    table += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

    // Create data rows
    rows.forEach(row => {
      // Pad row if it's shorter than headers
      const paddedRow = [...row];
      while (paddedRow.length < headers.length) {
        paddedRow.push('');
      }
      
      table += '| ' + paddedRow.slice(0, headers.length).map(cell => {
        // Escape pipe characters in cells
        return (cell || '').replace(/\|/g, '\\|');
      }).join(' | ') + ' |\n';
    });

    return table;
  }
}
