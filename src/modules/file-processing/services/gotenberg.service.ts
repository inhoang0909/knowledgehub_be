import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface GotenbergConversionResult {
  success: boolean;
  pdfPath?: string;
  error?: string;
  tempDir?: string;
}

@Injectable()
export class GotenbergService {
  private readonly logger = new Logger(GotenbergService.name);
  private readonly GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://gotenberg:3000';
  private readonly TIMEOUT_MS = Number(process.env.GOTENBERG_TIMEOUT_MS || 120000); // default 2 minutes

  constructor(private readonly httpService: HttpService) {}

  /**
   * Convert PPTX or DOCX file to PDF using Gotenberg
   * @param filePath - Path to the document file (PPTX or DOCX)
   * @returns Conversion result with path to the generated PDF
   */
  async convertToPdf(filePath: string): Promise<GotenbergConversionResult> {
    try {
      const fileName = path.basename(filePath);
      const fileExt = path.extname(filePath).toLowerCase();
      
      this.logger.log(`Converting ${fileName} to PDF using Gotenberg`);

      // Validate file type
      if (!['.pptx', '.docx', '.ppt', '.doc'].includes(fileExt)) {
        throw new Error(`Unsupported file type for conversion: ${fileExt}`);
      }

      // Create form data
      const formData = new FormData();
      formData.append('files', fs.createReadStream(filePath), {
        filename: fileName,
      });

      // Determine the correct Gotenberg endpoint
      const endpoint = this.getConversionEndpoint(fileExt);
      const url = `${this.GOTENBERG_URL}${endpoint}`;

      this.logger.log(`Sending conversion request to: ${url}`);

      // Send request to Gotenberg
      const response = await firstValueFrom(
        this.httpService.post(url, formData, {
          headers: {
            ...formData.getHeaders(),
          },
          timeout: this.TIMEOUT_MS,
          responseType: 'arraybuffer', // Get PDF as binary data
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        })
      );

      // Save the PDF to a temporary location
      const tempDir = path.join(
        os.tmpdir(),
        `gotenberg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      );
      await fs.promises.mkdir(tempDir, { recursive: true });
      
      const pdfFileName = path.basename(fileName, fileExt) + '.pdf';
      const pdfPath = path.join(tempDir, pdfFileName);
      
      await fs.promises.writeFile(pdfPath, response.data);

      this.logger.log(`Successfully converted ${fileName} to PDF: ${pdfPath}`);

      return {
        success: true,
        pdfPath,
        tempDir,
      };
    } catch (error) {
      this.logger.error(`Failed to convert document to PDF: ${error.message}`, error.stack);
      return {
        success: false,
        error: error.message || 'Unknown conversion error',
      };
    }
  }

  /**
   * Get the appropriate Gotenberg endpoint based on file type
   */
  private getConversionEndpoint(fileExt: string): string {
    switch (fileExt.toLowerCase()) {
      case '.pptx':
      case '.ppt':
      case '.docx':
      case '.doc':
        // LibreOffice endpoint handles both Office documents and presentations
        return '/forms/libreoffice/convert';
      default:
        throw new Error(`No endpoint configured for file type: ${fileExt}`);
    }
  }

  /**
   * Convert multiple documents to PDF
   * @param filePaths - Array of paths to document files
   * @returns Array of conversion results
   */
  async convertMultipleToPdf(filePaths: string[]): Promise<GotenbergConversionResult[]> {
    const results: GotenbergConversionResult[] = [];
    
    for (const filePath of filePaths) {
      const result = await this.convertToPdf(filePath);
      results.push(result);
    }

    return results;
  }
}
