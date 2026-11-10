# File Processing API - Installation & Usage Guide

## Overview

This API provides file processing capabilities for PDF, TXT, Excel (XLSX/XLS), CSV, PowerPoint (PPTX/PPT), and Word (DOCX/DOC) files. It uses:
- **Poppler** for PDF parsing and image extraction
- **Gotenberg** for converting PPTX/DOCX documents to PDF
- **OCR Service** for extracting text from images and PDF pages
- **pg-boss** for job queue management with PostgreSQL
- **NestJS** as the framework

### Document Processing Flow

1. **PDF Files**: Directly extracted to images → OCR processing
2. **PPTX/DOCX Files**: Converted to PDF via Gotenberg → Extracted to images → OCR processing
3. **Excel/CSV**: Parsed directly to markdown tables
4. **TXT**: Converted to markdown
5. **Images**: Sent directly to OCR service

## 🗄️ Storage Architecture

**All files and images are stored on the PHYSICAL FILE SYSTEM (hard drive), NOT in the database.**

- Original files: Stored in `UPLOAD_DIR` (default: `./uploads`)
- Extracted images (from PDFs): Stored in subdirectories on disk
- Generated markdown: Stored as `.md` files on disk
- Database stores: Only metadata and file paths (strings)

```
┌─────────────────────────────────────────────────┐
│        FILE SYSTEM (Physical Hard Drive)        │
├─────────────────────────────────────────────────┤
│  ./uploads/                                     │
│    ├── 1709452800000-document.pdf    ← Original│
│    ├── 1709452800000-document.md     ← Markdown│
│    └── document_output/              ← Images   │
│        ├── image-000.png                        │
│        ├── image-001.png                        │
│        └── image-002.png                        │
└─────────────────────────────────────────────────┘
                      ↕
              (Paths stored as strings)
                      ↕
┌─────────────────────────────────────────────────┐
│         DATABASE (PostgreSQL)                   │
├─────────────────────────────────────────────────┤
│  processed_files table:                         │
│    - file_path: "./uploads/...pdf"   (string)   │
│    - markdown_path: "./uploads/...md" (string)  │
│    - metadata: {"imagePaths": [...]} (JSON)     │
│    - NO BINARY DATA                             │
└─────────────────────────────────────────────────┘
```

See [STORAGE_ARCHITECTURE.md](STORAGE_ARCHITECTURE.md) for detailed explanation.

## Prerequisites

### 1. Install Poppler Utils

Poppler is required for PDF processing. Install it based on your OS:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install poppler-utils
```

**macOS:**
```bash
brew install poppler
```

**Windows:**
- Download from: https://blog.alivate.com.au/poppler-windows/
- Add to PATH

Verify installation:
```bash
pdfinfo -v
pdftotext -v
pdfimages -v
```

### 2. Start Gotenberg Service

Gotenberg is required for converting PPTX/DOCX files to PDF. It's configured in `docker-compose.yml`:

```yaml
gotenberg:
  image: gotenberg/gotenberg:8
  container_name: gotenberg-dev
  command:
    - "gotenberg"
    - "--api-port=3000"
  ports: 
    - "3000:3000"
  networks:
    - app-network
```

Start the service:
```bash
docker-compose up -d gotenberg
```

Verify Gotenberg is running:
```bash
curl http://localhost:3000/health
```

### 3. Install Node.js Dependencies

```bash
cd dify_backend
npm install pg-boss pdf-poppler xlsx csv-parse mammoth pdf-parse
npm install --save-dev @types/pg-boss
```

## Database Setup

### 1. Run Prisma Migration

```bash
npx prisma migrate dev --name add_file_processing
npx prisma generate
```

This will:
- Create the `processed_files` table
- Create the `pgboss` schema for job queue management

## Environment Variables

Add to your `.env` file:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/dify_wrapper"

# File upload directory (optional, defaults to ./uploads)
UPLOAD_DIR=./uploads

# Gotenberg service (for PPTX/DOCX conversion)
GOTENBERG_URL=http://gotenberg:3000  # or http://localhost:3000 if running locally
GOTENBERG_TIMEOUT_MS=120000  # Optional, default 2 minutes

# OCR Service (for image and PDF text extraction)
OCR_API_URL=http://gmo021.cansportsvg.com:10002/ocr/run
OCR_TEMPLATE_ID=imageocr
OCR_TEMPERATURE=0
OCR_TIMEOUT_MS=180000  # Optional, default 3 minutes
```

## API Endpoints

### 1. Upload File for Processing

**POST** `/file-processing/upload`

Upload a file (PDF, TXT, Excel, CSV, PowerPoint, Word, or images) for processing.

**Supported File Types:**
- **PDF** (`.pdf`) - Extracted to images and processed via OCR
- **PowerPoint** (`.pptx`, `.ppt`) - Converted to PDF via Gotenberg, then processed
- **Word** (`.docx`, `.doc`) - Converted to PDF via Gotenberg, then processed
- **Excel** (`.xlsx`, `.xls`) - Parsed directly to markdown tables
- **CSV** (`.csv`) - Parsed to markdown tables
- **Text** (`.txt`) - Converted to markdown
- **Images** (`.png`, `.jpg`, `.jpeg`, `.tiff`, `.gif`, `.webp`) - Processed via OCR

**Headers:**
- `Authorization: Bearer <token>`
- `Content-Type: multipart/form-data`

**Body:**
- `file`: File to upload (max 50MB)

**Response:**
```json
{
  "message": "File submitted for processing",
  "fileId": "clx...",
  "jobId": "job_123"
}
```

**Example with cURL:**
```bash
# Upload a PowerPoint presentation
curl -X POST http://localhost:9000/file-processing/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@presentation.pptx"

# Upload a Word document
curl -X POST http://localhost:9000/file-processing/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@document.docx"

# Upload a PDF
curl -X POST http://localhost:9000/file-processing/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@document.pdf"
```

### 2. List Files

**GET** `/file-processing/files?status=COMPLETED&skip=0&take=20`

List all processed files for the authenticated user.

**Query Parameters:**
- `status` (optional): Filter by status (PENDING, PROCESSING, COMPLETED, FAILED)
- `skip` (optional): Pagination offset (default: 0)
- `take` (optional): Number of items (default: 20)

**Response:**
```json
{
  "files": [
    {
      "id": "clx...",
      "originalName": "document.pdf",
      "fileType": "pdf",
      "fileSize": 1024000,
      "status": "COMPLETED",
      "createdAt": "2026-03-03T10:00:00Z",
      "processedAt": "2026-03-03T10:01:30Z"
    }
  ],
  "total": 1,
  "skip": 0,
  "take": 20
}
```

### 3. Get File Status

**GET** `/file-processing/files/:fileId`

Get detailed status of a specific file.

**Response:**
```json
{
  "id": "clx...",
  "originalName": "document.pdf",
  "status": "COMPLETED",
  "fileType": "pdf",
  "fileSize": 1024000,
  "markdownPath": "/uploads/document.md",
  "metadata": {
    "originalFile": "/uploads/document.pdf",
    "imagesCount": 5
  },
  "createdAt": "2026-03-03T10:00:00Z",
  "processedAt": "2026-03-03T10:01:30Z"
}
```

### 4. Get Markdown Content

**GET** `/file-processing/files/:fileId/markdown`

Get the processed markdown content.

**Response:**
```json
{
  "content": "# Document Title\n\nContent goes here..."
}
```

### 5. Delete File

**DELETE** `/file-processing/files/:fileId`

Delete a processed file and its associated data.

**Response:**
```json
{
  "message": "File deleted successfully"
}
```

## Processing Flow

1. **Upload**: User uploads file via API
2. **Store**: File saved to disk, record created in database
3. **Queue**: Job submitted to pg-boss queue
4. **Process**: Worker picks up job and processes file:
   - **PDF**: Extract text with `pdftotext`, extract images with `pdfimages`
   - **TXT**: Parse and format as markdown
   - **Excel**: Convert sheets to markdown tables
   - **CSV**: Convert to markdown table
5. **Complete**: Markdown saved, database updated

## File Type Support

### PDF Files
- Text extraction using `pdftotext`
- Image extraction using `pdfimages` (PNG format)
- Metadata extraction using `pdfinfo`

### TXT Files
- Plain text conversion to markdown
- Auto-detection of headings
- Paragraph formatting

### Excel Files (XLSX, XLS)
- Multiple sheet support
- Each sheet converted to markdown table
- Preserves data structure

### CSV Files
- Simple CSV to markdown table conversion
- Header row detection
- Column alignment

## Performance & Scaling

### Job Queue Configuration

The system uses pg-boss for reliable job processing:

- **Concurrency**: 5 workers process jobs simultaneously
- **Retry**: Failed jobs retry 2 times with 60s delay
- **Expiration**: Jobs expire after 7 days
- **Background**: Jobs run in background workers

### Optimizations

1. **Bottleneck Handling**: pg-boss manages queue efficiently
2. **Resource Limits**: 50MB file size limit
3. **Concurrent Processing**: Up to 5 files processed simultaneously
4. **Error Recovery**: Automatic retry with exponential backoff

## Swagger Documentation

Access API documentation at:
```
http://localhost:9000/api
```

## Monitoring

### Check Job Queue Status

```typescript
// In any service, inject PgBossService
const jobStatus = await this.pgBossService.getJobById(jobId);
```

### Database Queries

```sql
-- Check processing status
SELECT status, COUNT(*) 
FROM processed_files 
GROUP BY status;

-- Check pg-boss jobs
SELECT * FROM pgboss.job 
WHERE name = 'file-processing' 
ORDER BY createdon DESC 
LIMIT 10;
```

## Troubleshooting

### Poppler Not Found
```
Error: pdftotext: command not found
```
**Solution**: Install poppler-utils (see Prerequisites)

### Job Queue Not Starting
```
Error: Failed to start PgBoss
```
**Solution**: Check DATABASE_URL is correct and PostgreSQL is running

### File Upload Fails
```
Error: ENOENT: no such file or directory
```
**Solution**: Ensure UPLOAD_DIR exists or application has write permissions

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ Upload File
       ▼
┌─────────────────┐
│  Controller     │ ◄── AuthGuard validates user
└────────┬────────┘
         │ Save file & create record
         ▼
┌─────────────────┐
│   Service       │
└────────┬────────┘
         │ Send job to queue
         ▼
┌─────────────────┐
│   pg-boss       │ ◄── PostgreSQL-based job queue
└────────┬────────┘
         │ Worker picks up job
         ▼
┌─────────────────┐
│  Worker Service │
└────────┬────────┘
         │ Route to appropriate parser
         ▼
┌─────────────────────────────────┐
│ PDF │ TXT │ Excel │ CSV Parser │
└─────────────────┬───────────────┘
                  │ Convert to Markdown
                  ▼
┌─────────────────────────────────┐
│  Save .md file & Update DB      │
└─────────────────────────────────┘
```

## Future Enhancements

- [ ] Support for DOCX files (using mammoth)
- [ ] Cloud storage integration (S3, GCS)
- [ ] Webhook notifications when processing completes
- [ ] Batch file upload
- [ ] Advanced PDF OCR for scanned documents
- [ ] Custom markdown templates
