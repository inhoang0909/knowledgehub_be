/**
 * Diagnostic script to check file type detection issues
 * Usage: npx tsx scripts/diagnose-file.ts <file-path>
 */

import * as fs from 'fs/promises';
import * as path from 'path';

async function diagnoseFile(filePath: string) {
  console.log('='.repeat(60));
  console.log('FILE TYPE DIAGNOSTIC');
  console.log('='.repeat(60));
  
  try {
    // Check if file exists
    const stats = await fs.stat(filePath);
    console.log(`\n✓ File found: ${filePath}`);
    console.log(`  Size: ${stats.size} bytes (${(stats.size / 1024).toFixed(2)} KB)`);
    
    // Get extension
    const ext = path.extname(filePath);
    console.log(`  Extension: ${ext || '(none)'}`);
    
    // Read first 512 bytes
    const buffer = await fs.readFile(filePath);
    const sampleSize = Math.min(512, buffer.length);
    const sample = buffer.slice(0, sampleSize);
    
    console.log(`\n📋 First ${sampleSize} bytes analyzed:`);
    
    // Check for PDF signature
    if (buffer.length >= 5 && buffer.toString('utf-8', 0, 5) === '%PDF-') {
      console.log('  ✓ PDF signature detected (%PDF-)');
      console.log(`  PDF version: ${buffer.toString('utf-8', 0, 8)}`);
      return 'pdf';
    } else {
      console.log('  ✗ No PDF signature found');
    }
    
    // Check for Excel XLSX
    if (buffer.length >= 4 && 
        buffer[0] === 0x50 && buffer[1] === 0x4B && 
        buffer[2] === 0x03 && buffer[3] === 0x04) {
      console.log('  ✓ ZIP signature detected (PK\\x03\\x04)');
      const content = buffer.toString('utf-8');
      if (content.includes('xl/workbook.xml') || content.includes('xl/')) {
        console.log('  ✓ Excel XLSX detected (contains xl/ structure)');
        return 'xlsx';
      }
    }
    
    // Check for old Excel XLS
    if (buffer.length >= 8 &&
        buffer[0] === 0xD0 && buffer[1] === 0xCF &&
        buffer[2] === 0x11 && buffer[3] === 0xE0) {
      console.log('  ✓ OLE signature detected (old Excel XLS)');
      return 'xls';
    }
    
    // Check if it's text
    let textChars = 0;
    let controlChars = 0;
    for (let i = 0; i < sampleSize; i++) {
      const byte = sample[i];
      if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13 || byte >= 128) {
        textChars++;
      } else {
        controlChars++;
      }
    }
    
    const textRatio = textChars / sampleSize;
    console.log(`\n📊 Text analysis:`);
    console.log(`  Printable characters: ${textChars}/${sampleSize} (${(textRatio * 100).toFixed(1)}%)`);
    console.log(`  Control characters: ${controlChars}/${sampleSize}`);
    
    if (textRatio > 0.9) {
      console.log('  → Likely a text file');
      
      // Check for CSV pattern
      const text = sample.toString('utf-8');
      const lines = text.split('\n').slice(0, 10);
      const commaCount = lines[0]?.split(',').length - 1 || 0;
      const semicolonCount = lines[0]?.split(';').length - 1 || 0;
      
      if (commaCount > 0 || semicolonCount > 0) {
        console.log(`  → CSV pattern detected (${Math.max(commaCount, semicolonCount)} delimiters per line)`);
        return 'csv';
      }
      
      return 'txt';
    } else {
      console.log('  → Binary file (not plain text)');
    }
    
    // Show hex dump of first 64 bytes
    console.log(`\n🔍 Hex dump (first 64 bytes):`);
    const hexDump = buffer.slice(0, 64);
    for (let i = 0; i < hexDump.length; i += 16) {
      const chunk = hexDump.slice(i, i + 16);
      const hex = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
      const ascii = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
      console.log(`  ${i.toString(16).padStart(4, '0')}: ${hex.padEnd(48, ' ')} | ${ascii}`);
    }
    
    return 'unknown';
    
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}`);
    process.exit(1);
  }
}

// Main execution
const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npx tsx scripts/diagnose-file.ts <file-path>');
  process.exit(1);
}

diagnoseFile(filePath).then(detectedType => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`RESULT: Detected file type = ${detectedType}`);
  console.log('='.repeat(60));
});
