import type { File } from '..';
import { StorageAdapter } from './StorageAdapter';

export class BufferStorageAdapter extends StorageAdapter<
    Omit<File, 'stream' | 'encoding'> & { buffer: Buffer }
> {
    public async processFile(file: File) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of file.stream) {
            chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        return {
            name: file.name,
            buffer,
            mimeType: file.mimeType,
            filename: file.filename,
        };
    }

    public async rollback() {
        // No rollback needed.
    }
}
