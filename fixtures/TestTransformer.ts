import type { File } from '../src';
import { FileTransformer } from '../src/Transformers/FileTransformer';

export class TestTransformer extends FileTransformer {
    public async transformFile(file: File): Promise<File> {
        return await new Promise<File>((resolve) => {
            resolve({
                name: file.name,
                stream: file.stream,
                mimeType: file.mimeType,
                encoding: file.encoding,
                filename: 'foo.bar',
            });
        });
    }
}
