import { MultiParser, multiParserMiddleware } from '.';
import { RequestErroredError, RollbackError } from './errors';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import express, {
    type NextFunction,
    type Request,
    type RequestHandler,
    type Response,
} from 'express';
import { getIdContext, setIdContext } from '../fixtures/AsyncLocalStorage';
//import type { AddressInfo } from 'net';
import { BufferStorageAdapter } from './Adapters';
import type TestAgent from 'supertest/lib/agent';
import { TestTransformer } from '../fixtures/TestTransformer';
import type core from 'express-serve-static-core';
import type http from 'http';
import path from 'path';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import request from 'supertest';

const defaultMultipartMiddleware = multiParserMiddleware({
    adapter: new BufferStorageAdapter(),
});

let requestAgent: TestAgent;
let server: http.Server;
let reqPromise: Promise<Request>;

// There is a race condition in the supertest attach method that causes an ECONNRESET error in tests.
// stackoverflow.com/questions/71682239/supertest-failing-with-econnreset

/* eslint-disable @typescript-eslint/no-explicit-any */
const getMultiparserServer = async <
    Route extends string,
    P = core.RouteParameters<Route>,
    ResBody = any,
    ReqBody = any,
    ReqQuery = qs.ParsedQs,
    LocalsObj extends Record<string, any> = Record<string, any>,
>(
    handlerStack: Array<
        RequestHandler<P, ResBody, ReqBody, ReqQuery, LocalsObj>
    >,
) => {
    if (server) server.close();
    const app = express();
    app.post(
        '/api',
        ...handlerStack,
        (req, _, next) => {
            reqPromise = new Promise((resolve) => {
                resolve(req as Request);
            });
            next();
        },
        (_, res) => res.json({} as ResBody),
    );
    // Generic error middleware.
    app.use((err: Error, _: Request, res: Response, next: NextFunction) => {
        if (res.headersSent) return void next(err);
        res.status(500).json(
            err instanceof RollbackError
                ? {
                      message: err.message,
                      name: err.name,
                      originalError: {
                          message: err.originalError.message,
                          name: err.originalError.name,
                      },
                      rollbackError: {
                          message: err.rollbackError.message,
                          name: err.rollbackError.name,
                      },
                  }
                : {
                      message: err.message,
                      name: err.name,
                  },
        );
    });
    return new Promise<{ server: http.Server; requestAgent: TestAgent }>(
        (resolve) => {
            server = app.listen(() => {
                requestAgent = request(app);
                resolve({ server, requestAgent });
            });
        },
    );
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('index', () => {
    beforeEach(async () => {
        ({ server, requestAgent } = await getMultiparserServer([
            defaultMultipartMiddleware,
        ]));
    });
    afterEach((done) => {
        // @ts-expect-error Restoring the promise to it's original state, so that a subsequent test cannot accidentally use the old promise result.
        reqPromise = undefined;
        if (server) server.close(done);
    });

    it('should parse multipart fields', async () => {
        const res = await requestAgent.post('/api').field('foo', 'bar');
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.body.fields).toEqual([
            {
                name: 'foo',
                value: 'bar',
            },
        ]);
    });

    it('should parse multipart files', async () => {
        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent
            .post('/api')
            .attach('file', file, { filename: 'test.json' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.body.files).toHaveLength(1);
        expect(req.body.files[0].name).toBe('file');
        expect(req.body.files[0].filename).toBe('test.json');
        expect(req.body.files[0].mimeType).toBe('application/json');
        expect(req.body.files[0].buffer).toBeInstanceOf(Buffer);
    });

    it('should parse multipart fields and files', async () => {
        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent
            .post('/api')
            .field('foo', 'bar')
            .attach('file', file, { filename: 'test.json' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.body.fields).toEqual([
            {
                name: 'foo',
                value: 'bar',
            },
        ]);
        expect(req.body.files).toHaveLength(1);
        expect(req.body.files[0].name).toBe('file');
        expect(req.body.files[0].filename).toBe('test.json');
        expect(req.body.files[0].mimeType).toBe('application/json');
        expect(req.body.files[0].buffer).toBeInstanceOf(Buffer);
    });

    it('should apply file transformer', async () => {
        // Custom server setup.
        getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                transformer: new TestTransformer(),
            }),
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent.post('/api').attach('file', file);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.body.files[0].filename).toBe('foo.bar');
    });

    it('should pass files through the fileFilter', async () => {
        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                options: {
                    fileFilter: (file) => {
                        return file.filename === 'test.json';
                    },
                },
            }),
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent
            .post('/api')
            .attach('file', file, { filename: 'test.json' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.body.files).toHaveLength(1);
        expect(req.body.files[0].filename).toBe('test.json');
    });

    it('should filter files with fileFilter', async () => {
        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                options: {
                    fileFilter: (file) => {
                        return !!file.filename;
                    },
                },
            }),
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent.post('/api').attach('file', file);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.body.files).toHaveLength(0);
    });

    it('should handle content-type errors from busboy', async () => {
        const { requestAgent } = await getMultiparserServer([
            (req, _, next) => {
                delete req.headers['content-type'];
                next();
            },
            defaultMultipartMiddleware,
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent.post('/api').attach('file', file);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'Invalid content type.',
            name: 'ContentTypeError',
        });
    });

    it('should preserve asyncLocalStorage context', async () => {
        const testId = randomUUID();
        const { requestAgent } = await getMultiparserServer([
            // Set ALS context.
            setIdContext(testId),
            defaultMultipartMiddleware,
            // Get ALS context after parsing and set it in the request headers to validate.
            (req, _2, next) => {
                req.headers['x-test-id'] = getIdContext();
                next();
            },
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent.post('/api').attach('foo', file);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({});

        const req = await reqPromise;
        expect(req.headers['x-test-id']).toBe(testId);
    });

    it('should respect maxFields', async () => {
        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                options: {
                    maxFields: 1,
                },
            }),
        ]);

        const res = await requestAgent
            .post('/api')
            .field('foo', 'bar')
            .field('baz', 'qux');
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'Field limit reached.',
            name: 'FieldLimitError',
        });
    });

    it('should respect maxFiles', async () => {
        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                options: {
                    maxFiles: 1,
                },
            }),
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent
            .post('/api')
            .attach('file1', file)
            .attach('file2', file);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'File limit reached.',
            name: 'FileLimitError',
        });
    });

    it('should respect maxParts', async () => {
        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                options: {
                    maxParts: 1,
                },
            }),
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent
            .post('/api')
            .attach('file', file)
            .field('foo', 'bar');
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'Part limit reached.',
            name: 'PartLimitError',
        });
    });

    it('should respect maxFieldNameSize', async () => {
        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter: new BufferStorageAdapter(),
                options: {
                    maxFieldNameSize: 2, // 2 bytes
                },
            }),
        ]);

        const res = await requestAgent.post('/api').field('foo', 'bar'); // 3 bytes
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'Field name size limit reached.',
            name: 'FieldNameSizeError',
        });
    });

    it('should handle aborted request', async () => {
        const file = await readFile(path.resolve('fixtures/test.json'));
        server.close();
        const app = express();
        app.post('/api', (req, res) => {
            // @ts-expect-error test
            const multiParser = new MultiParser({
                req,
                adapter: new BufferStorageAdapter(),
            });
            // Trigger request error.
            req.emit('aborted');

            multiParser['parse']()
                .then(() => {
                    // Fail if parse somehow succeeds.
                    throw new Error('Parse should not succeed.');
                })
                .catch((err: unknown) => {
                    expect(err).toBeInstanceOf(RequestErroredError);
                });

            // Destroy the open writeableStream (response).
            res.destroy();
        });
        const requestAgent = await new Promise<TestAgent>((resolve) => {
            server = app.listen(() => {
                resolve(request(app));
            });
        });

        try {
            await requestAgent.post('/api').attach('file', file);
        } catch (err) {
            expect((err as Error).message).toBe('socket hang up');
        }
    });

    it('should handle rollback error', async () => {
        const adapter = new BufferStorageAdapter();
        adapter.rollback = async () => {
            throw new Error('Custom rollback error.');
        };

        const { requestAgent } = await getMultiparserServer([
            multiParserMiddleware({
                adapter,
                options: {
                    maxParts: 1,
                },
            }),
        ]);

        const file = await readFile(path.resolve('fixtures/test.json'));
        const res = await requestAgent
            .post('/api')
            .attach('file1', file)
            .attach('file2', file);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'Rollback failed.',
            name: 'RollbackError',
            originalError: {
                message: 'Part limit reached.',
                name: 'PartLimitError',
            },
            rollbackError: {
                message: 'Custom rollback error.',
                name: 'Error',
            },
        });
    });

    it('should handle malformed requests', async () => {
        ({ requestAgent } = await getMultiparserServer([
            defaultMultipartMiddleware,
        ]));

        const boundary = 'AaB03x';
        const body = [
            '--' + boundary,
            'Content-Disposition: form-data; name="file"; filename="test.txt"',
            'Content-Type: text/plain',
            '',
            'test without end boundary',
        ].join('\r\n');

        const res = await requestAgent
            .post('/api')
            .set('content-type', 'multipart/form-data; boundary=' + boundary)
            .set('content-length', String(body.length))
            .send(body);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual({
            message: 'Unexpected end of form',
            name: 'Error',
        });
    });
});
