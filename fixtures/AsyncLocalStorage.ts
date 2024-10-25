import { AsyncLocalStorage } from 'async_hooks';
import type { RequestHandler } from 'express';

const randomIdContext = new AsyncLocalStorage<string>();

export const setIdContext =
    (id: string): RequestHandler =>
    (_1, _2, next) => {
        randomIdContext.run(id, next);
    };

export const getIdContext = () => randomIdContext.getStore();
