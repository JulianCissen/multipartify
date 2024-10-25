import {
    ContentTypeError,
    FieldLimitError,
    FieldNameSizeError,
    FileLimitError,
    PartLimitError,
    RequestErroredError,
    RollbackError,
} from './errors';
import EventEmitter from 'events';
import type { FileTransformer } from './Transformers/FileTransformer';
import type { IncomingMessage } from 'http';
import type { RequestHandler } from 'express';
import type { StorageAdapter } from './Adapters';
import busboy from 'busboy';
import type core from 'express-serve-static-core';
import type internal from 'stream';

export interface Field {
    name: string;
    value: string;
}
export interface File {
    name: string;
    stream: internal.Readable & { truncated?: boolean };
    encoding: string;
    mimeType: string;
    filename: string;
}
type FileFilter = (file: File) => Promise<boolean> | boolean;
export interface MultiParterOptions {
    maxFieldNameSize: number;
    maxFieldSize: number;
    maxFields: number;
    maxFileSize: number;
    maxFiles: number;
    maxParts: number;
    maxHeaderPairs: number;
    fileFilter?: FileFilter;
}

const defaultMultiParterOptions: MultiParterOptions = {
    maxFieldNameSize: 100, // 100 bytes
    maxFieldSize: 1024 * 1024, // 1MB
    maxFields: 1000,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    maxFiles: 10,
    maxParts: 1000,
    maxHeaderPairs: 2000, // NodeJS http module default
};

// Extend event emitter to make the interal promise externally resolvable.
export class MultiParter<T extends Partial<File>> extends EventEmitter {
    private fields: Field[] = [];
    private files: T[] = [];

    private options: MultiParterOptions;
    private busboyInstance!: busboy.Busboy;

    private _processingFiles = 0;
    private get processingFiles() {
        return this._processingFiles;
    }
    private set processingFiles(value) {
        this._processingFiles = value;
        if (this.processingFiles === 0) {
            this.emit('noPendingFiles');
        }
    }

    private adapter: StorageAdapter<T>;
    private transformer?: FileTransformer;

    private promise = new Promise<{ fields: Field[]; files: T[] }>(
        (resolve, reject) => {
            this.once('rejected', (error: Error) => {
                reject(error);
            });
            this.once('resolved', (fields: Field[], files: T[]) =>
                resolve({ fields, files }),
            );
        },
    );

    private constructor({
        req,
        adapter,
        options,
        transformer,
    }: {
        req: IncomingMessage;
        adapter: StorageAdapter<T>;
        options?: Partial<MultiParterOptions>;
        transformer?: FileTransformer;
    }) {
        super();
        this.options = {
            ...defaultMultiParterOptions,
            ...options,
        };
        this.adapter = adapter;
        if (transformer) this.transformer = transformer;

        // Initialize a busboy instance.
        try {
            this.busboyInstance = busboy({
                headers: req.headers,
                limits: {
                    fieldNameSize: this.options.maxFieldNameSize,
                    fieldSize: this.options.maxFieldSize,
                    fields: this.options.maxFields,
                    fileSize: this.options.maxFileSize,
                    files: this.options.maxFiles,
                    parts: this.options.maxParts,
                    headerPairs: this.options.maxHeaderPairs,
                },
            });
        } catch {
            // busboy can throw an error during initialization if the content type is invalid.
            throw new ContentTypeError();
        }

        // Set busboy event listeners.
        this.busboyInstance
            .on('field', (name, value) => this.handleField(name, value))
            .on('file', (name, stream, info) => {
                // Increment processing files count.
                this.processingFiles++;
                this.handleFile(name, stream, info).then(
                    // Decrement processing files count after handling file.
                    () => this.processingFiles--,
                );
            })
            .on('error', (error: Error) => this.reject(error))
            .on('finish', () => this.resolve())
            .on('fieldsLimit', () => this.reject(new FieldLimitError()))
            .on('filesLimit', () => this.reject(new FileLimitError()))
            .on('partsLimit', () => this.reject(new PartLimitError()));

        // Set request event listener to destroy busboy on error.
        req.on('aborted', () => {
            this.busboyInstance.end();
            this.reject(new RequestErroredError());
        });

        req.pipe(this.busboyInstance);

        this.once('finished', () => {
            req.unpipe(this.busboyInstance);
            req.resume();
            this.busboyInstance.removeAllListeners();
        });
    }
    public static async create<T extends Partial<File>>(constructorParams: {
        req: IncomingMessage;
        adapter: StorageAdapter<T>;
        options?: Partial<MultiParterOptions>;
        transformer?: FileTransformer;
    }): Promise<{ fields: Field[]; files: T[] }> {
        return await new Promise((resolve, reject) => {
            try {
                const multiParter = new MultiParter(constructorParams);
                // Make sure to set a then and catch here, since the promise handler is a synchronous function and will not await the parse method.
                multiParter.parse().then(resolve).catch(reject);
            } catch (err) {
                // Make sure to try catch here in a promise wrapper, since the constructor can throw a ContentTypeError synchronously.
                reject(err);
            }
        });
    }

    private resolve(): void {
        new Promise<void>((resolve) => {
            this.once('noPendingFiles', resolve);
            // If processingFiles is currently at 0, fire the event manually.
            if (this.processingFiles === 0) {
                this.emit('noPendingFiles');
            }
        }).then(() => {
            this.emit('resolved', this.fields, this.files);
            this.emit('finished');
        });
    }
    private reject(error: Error): void {
        // Allow for rolling back fs changes.
        this.adapter
            .rollback()
            .then(() => {
                this.emit('rejected', error);
                this.emit('finished');
            })
            .catch((rollbackError) => {
                this.emit('rejected', new RollbackError(error, rollbackError));
                this.emit('finished');
            });
    }

    private async parse(): Promise<typeof this.promise> {
        return await this.promise;
    }

    private handleField(name: string, value: string) {
        name = this.processFieldName(name);
        this.fields.push({ name, value });
    }

    private async handleFile(
        name: string,
        stream: internal.Readable & { truncated?: boolean },
        { encoding, mimeType, filename }: busboy.FileInfo,
    ): Promise<void> {
        name = this.processFieldName(name);

        if (this.options.fileFilter) {
            const result = await this.options.fileFilter({
                name,
                stream,
                encoding,
                mimeType,
                filename,
            });
            // Resume consumes the stream data and discards it.
            if (!result) return void stream.resume();
        }

        // Transform file if transformer is provided.
        const transformedFile = this.transformer
            ? await this.transformer.transformFile({
                  name,
                  stream,
                  encoding,
                  mimeType,
                  filename,
              })
            : { name, stream, encoding, mimeType, filename };
        // Process file with the adapter.
        const processedFile = await this.adapter.processFile(transformedFile);

        this.files.push(processedFile);
    }

    private processFieldName(name: string): string {
        // fieldNameSize is not actually implemented in busboy.
        // https://github.com/mscdex/busboy/pull/59
        // Implementing it here for hardening purposes.
        if (name.length > this.options.maxFieldNameSize)
            this.reject(new FieldNameSizeError());
        return name;
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const multiParterMiddleware =
    <
        P = core.ParamsDictionary,
        ResBody = any,
        FType extends Partial<File> = File,
        ReqQuery = qs.ParsedQs,
        Locals extends Record<string, any> = Record<string, any>,
    >(multiParterOptions: {
        adapter: StorageAdapter<FType>;
        options?: Partial<MultiParterOptions>;
        transformer?: FileTransformer;
    }): RequestHandler<
        P,
        ResBody,
        {
            fields: Field[];
            files: FType[];
        },
        ReqQuery,
        Locals
    > =>
    (req, _, next) =>
        MultiParter.create({ req, ...multiParterOptions })
            .then(({ fields, files }) => {
                req.body = {
                    fields,
                    files,
                };
                next();
            })
            .catch((err) => {
                next(err);
            });

export * from './errors';
