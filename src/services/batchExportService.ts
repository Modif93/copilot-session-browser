import { ExportOptions, SessionWithMessages } from '../models/types';
import { ExporterService } from './exporterService';

/** Write sequentially to bound memory usage; one failed session does not stop the batch. */
export async function exportSessionFiles(
  sessions: SessionWithMessages[],
  options: ExportOptions,
  writeFile: (filename: string, content: string) => Promise<void>,
  reportProgress: (completed: number, total: number) => void = () => {},
): Promise<{ saved: number; failures: { filename: string; message: string }[] }> {
  const exporter = new ExporterService();
  const failures: { filename: string; message: string }[] = [];
  let saved = 0;
  for (const [position, session] of sessions.entries()) {
    let filename = `${String(position + 1).padStart(4, '0')}-session${exporter.fileExtension(options.format)}`;
    try {
      // A numeric prefix prevents collisions for identical titles, dates, or IDs.
      filename = `${String(position + 1).padStart(4, '0')}-${exporter.defaultFilename(session, options.format)}`;
      await writeFile(filename, exporter.export(session, options));
      saved++;
    } catch (err: unknown) {
      failures.push({ filename, message: err instanceof Error ? err.message : String(err) });
    }
    reportProgress(position + 1, sessions.length);
  }
  return { saved, failures };
}
