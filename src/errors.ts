export class RequestErroredError extends Error {
    constructor(message: string = 'Request errored.') {
        super(message);
        this.name = 'RequestErroredError';
    }
}

export class FieldNameSizeError extends Error {
    constructor(message: string = 'Field name size limit reached.') {
        super(message);
        this.name = 'FieldNameSizeError';
    }
}

export class FieldLimitError extends Error {
    constructor(message: string = 'Field limit reached.') {
        super(message);
        this.name = 'FieldLimitError';
    }
}

export class FileLimitError extends Error {
    constructor(message: string = 'File limit reached.') {
        super(message);
        this.name = 'FileLimitError';
    }
}

export class PartLimitError extends Error {
    constructor(message: string = 'Part limit reached.') {
        super(message);
        this.name = 'PartLimitError';
    }
}

export class ContentTypeError extends Error {
    constructor(message: string = 'Invalid content type.') {
        super(message);
        this.name = 'ContentTypeError';
    }
}

export class RollbackError extends Error {
    public originalError: Error;
    public rollbackError: Error;

    constructor(
        originalError: Error,
        rollbackError: Error,
        message: string = 'Rollback failed.',
    ) {
        super(message);
        this.name = 'RollbackError';
        this.originalError = originalError;
        this.rollbackError = rollbackError;
    }
}
