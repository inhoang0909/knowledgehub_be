import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as FormData from 'form-data';
import * as fs from 'fs';

export interface OCRResponse {
  success: boolean;
  content: string;
  error?: string;
}

@Injectable()
export class OCRService {
  private readonly logger = new Logger(OCRService.name);
  private readonly OCR_API_URL = process.env.OCR_API_URL || 'http://localhost:10002/ocr/run';
  private readonly OCR_TEMPLATE_ID = process.env.OCR_TEMPLATE_ID || 'imageocr';
  private readonly OCR_TEMPERATURE = Number(process.env.OCR_TEMPERATURE || 0);
  // Use configured timeout (ms) but double it here to allow a longer window
  private readonly OCR_TIMEOUT_MS = (Number(process.env.OCR_TIMEOUT_MS || 180000) || 180000);
  private readonly OCR_MAX_ATTEMPTS = Math.max(1, Number(process.env.OCR_MAX_ATTEMPTS || 2) || 2);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Process a single image through OCR API
   * @param imagePath - Path to the image file on disk
   * @returns OCR result with parsed content
   */
  async processImage(imagePath: string): Promise<OCRResponse> {
    for (let attempt = 1; attempt <= this.OCR_MAX_ATTEMPTS; attempt++) {
      try {
        this.logger.log(`Processing image: ${imagePath} (attempt ${attempt}/${this.OCR_MAX_ATTEMPTS})`);

        // Create form data
        const formData = new FormData();
        formData.append('template_id_or_alias', this.OCR_TEMPLATE_ID);
        formData.append('file', fs.createReadStream(imagePath));
        formData.append('debug_prompts', 'false');
        formData.append('temperature', String(this.OCR_TEMPERATURE));

        // Send request to OCR API
        const response = await firstValueFrom(
          this.httpService.post(this.OCR_API_URL, formData, {
            headers: {
              ...formData.getHeaders(),
            },
            timeout: this.OCR_TIMEOUT_MS,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
          })
        );

        // Extract content from response
        const content = this.extractContent(response.data);

        this.logger.log(`Successfully processed image: ${imagePath}`);
        return {
          success: true,
          content,
        };
      } catch (error) {
        const errAny: any = error;
        const isTimeout = errAny?.code === 'ECONNABORTED' || (errAny?.message && /timeout/i.test(errAny.message));
        const isRetryableNetworkError = [
          'ECONNRESET',
          'ETIMEDOUT',
          'EAI_AGAIN',
          'ENETUNREACH',
          'EPIPE',
          'socket hang up',
        ].includes(errAny?.code) || /socket hang up|network error|connection reset/i.test(errAny?.message || '');

        const shouldRetry = attempt < this.OCR_MAX_ATTEMPTS && (isTimeout || isRetryableNetworkError);

        if (shouldRetry) {
          this.logger.warn(
            `OCR transient error on ${imagePath} (attempt ${attempt}/${this.OCR_MAX_ATTEMPTS}): ${errAny?.message || String(errAny)}. Retrying...`,
          );
          await this.delay(300 * attempt);
          continue;
        }

        if (isTimeout) {
          const msg = `OCR request timed out after ${this.OCR_TIMEOUT_MS}ms`;
          this.logger.warn(`${msg} for image ${imagePath} after ${attempt} attempt(s)`);
          return {
            success: false,
            content: '',
            error: msg,
          };
        }

        this.logger.error(`Failed to process image ${imagePath}: ${errAny?.message || String(errAny)}`);
        return {
          success: false,
          content: '',
          error: errAny?.message || String(errAny),
        };
      }
    }

    return {
      success: false,
      content: '',
      error: 'OCR processing failed after retry attempts',
    };
  }

  /**
   * Process multiple images in sequence
   * @param imagePaths - Array of image file paths
   * @returns Combined markdown content from all images
   */
  async processImages(imagePaths: string[]): Promise<string> {
    const results: string[] = new Array(imagePaths.length);
    let successCount = 0;
    let failureCount = 0;
    const CONCURRENCY_LIMIT = 3;

    this.logger.log(`Starting OCR processing for ${imagePaths.length} images`);

    for (let i = 0; i < imagePaths.length; i += CONCURRENCY_LIMIT) {
      const chunk = imagePaths.slice(i, i + CONCURRENCY_LIMIT);

      const chunkPromises = chunk.map(async (imagePath, index) => {
        const actualIndex = i + index;
        const result = await this.processImage(imagePath);

        if (result.success && result.content.trim()) {
          // Store only the actual content, with page number as a simple header
          results[actualIndex] = `## Page ${actualIndex + 1}\n${result.content.trim()}`;
          successCount++;
        } else if (result.success && !result.content.trim()) {
          // OCR succeeded but page is empty/blank
          results[actualIndex] = `## Page ${actualIndex + 1}\n*(This page appears to be blank or contains no recognizable text)*`;
          successCount++;
        } else {
          // OCR failed
          results[actualIndex] = `## Page ${actualIndex + 1}\n*[OCR Processing Failed: ${result.error || 'Unknown error'}]*`;
          failureCount++;
        }
      });

      await Promise.all(chunkPromises);

      // Add delay between batches to avoid overwhelming OCR API
      if (i + CONCURRENCY_LIMIT < imagePaths.length) {
        await this.delay(1000);
      }
    }

    this.logger.log(`OCR processing complete: ${successCount} succeeded, ${failureCount} failed`);

    // Combine all results into a single markdown document (use single-line separators)
    const combinedContent = results.join('\n---\n');
    return combinedContent;
  }

  /**
   * Extract text content from OCR API response
   * The API returns: { status, mode, extraction, model, endpoint, response, zones_count }
   * We only need the 'response' field which contains the actual text content
   */
  private extractContent(data: any): string {
    // Helper to clean Vision Endpoint markers and normalize spacing
    const clean = (s: string) =>
      s
        .replace(/\[\s*Vision Endpoint:\s*[^\]]*\]/gi, '')
        .replace(/\r\n/g, '\n')
        // remove trailing spaces at end of lines
        .replace(/[ \t]+\n/g, '\n')
        // collapse any sequence of blank/whitespace-only lines into a single newline
        .replace(/\n\s*\n+/g, '\n')
        .trim();

    if (typeof data === 'string') {
      return clean(data);
    }

    // Primary format: { response: "actual text content here" }
    if (data.response) {
      return clean(String(data.response));
    }

    // Fallback formats
    if (data.text) {
      return clean(String(data.text));
    }

    if (data.content) {
      return clean(String(data.content));
    }

    if (data.result) {
      if (typeof data.result === 'string') {
        return clean(data.result);
      }
      if (data.result.response) {
        return clean(String(data.result.response));
      }
      if (data.result.text) {
        return clean(String(data.result.text));
      }
    }

    // If we can't find the content, log the structure and return empty
    this.logger.warn('Unknown OCR response structure:', JSON.stringify(data, null, 2));
    return '';
  }

  /**
   * Simple delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
