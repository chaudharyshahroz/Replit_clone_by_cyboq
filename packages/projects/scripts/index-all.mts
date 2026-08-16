/** Index every ready file that has extracted text but no chunks yet. */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { closeDatabase, db, fileChunks, files } from '@reklu/database';
import { indexFile } from '@reklu/projects';

const rows = await db
  .select({ id: files.id, filename: files.filename })
  .from(files)
  .where(and(isNull(files.deletedAt), isNotNull(files.extractedText)));

let indexed = 0;
for (const file of rows) {
  const existing = await db.select({ id: fileChunks.id }).from(fileChunks).where(eq(fileChunks.fileId, file.id)).limit(1);
  if (existing.length > 0) continue;
  const result = await indexFile(file.id);
  console.log(`  ${file.filename}: ${result.chunks} chunks${result.embedded ? ' (embedded)' : ' (lexical only)'}`);
  indexed++;
}
console.log(`indexed ${indexed} file(s)`);
await closeDatabase();
