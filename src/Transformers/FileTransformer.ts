import type { File } from '..';

export abstract class FileTransformer {
    public abstract transformFile(file: File): Promise<File>;
}
