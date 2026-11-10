import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';

export interface ParsedResult {
  markdown: string;
  metadata?: any;    // Metadata object (no binary data)
}

@Injectable()
export class ExcelParserService {
  private readonly logger = new Logger(ExcelParserService.name);

  /**
   * Parse Excel file (XLSX, XLS) and convert to markdown
   * @param filePath - Path to the Excel file
   * @returns Parsed result with markdown content
   */
  async parseExcelToMarkdown(filePath: string): Promise<ParsedResult> {
    try {
      const fileName = path.basename(filePath);
      const fileBuffer = await fs.readFile(filePath);
      
      // Read the workbook
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });

      let markdown = `# ${fileName}\n\n`;

      // Process each sheet
      workbook.SheetNames.forEach((sheetName, index) => {
        const sheet = workbook.Sheets[sheetName];
        
        markdown += `## Sheet: ${sheetName}\n\n`;

        // Convert sheet to JSON
        const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        if (jsonData.length === 0) {
          markdown += '*Empty sheet*\n\n';
          return;
        }

        // Create markdown table
        markdown += this.createMarkdownTable(jsonData as any[][]);
        markdown += '\n\n';
      });

      return {
        markdown,
        metadata: {
          originalFile: filePath,
          sheetsCount: workbook.SheetNames.length,
          sheets: workbook.SheetNames,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to parse Excel: ${filePath}`, error);
      throw new Error(`Excel parsing failed: ${error.message}`);
    }
  }

  /**
   * Create a markdown table from 2D array
   */
  private createMarkdownTable(data: any[][]): string {
    if (data.length === 0) return '';

    const headers = data[0];
    const rows = data.slice(1);

    // Create header row
    let table = '| ' + headers.map(h => String(h || '')).join(' | ') + ' |\n';
    
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
        const cellStr = String(cell ?? '');
        // Escape pipe characters in cells
        return cellStr.replace(/\|/g, '\\|');
      }).join(' | ') + ' |\n';
    });

    return table;
  }
}
