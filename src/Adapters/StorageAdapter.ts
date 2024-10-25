import type { File } from '..';

export abstract class StorageAdapter<T extends Partial<File>> {
    public abstract processFile(file: File): Promise<T>;

    public abstract rollback(): Promise<void>;
}
