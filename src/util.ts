export function isNotUndefined<T>(value: T | undefined): value is T {
    if (value === undefined) {
        return false;
    }

    return true;
}

export function inspectError(error: any): string {
    let message: string;
    if (typeof error !== 'object') {
        message = `${error}`;
    } else if (error === null) {
        message = "null";
    } else if (typeof error.message === 'string' && error.message.length > 0) {
        message = error.message;
    } else if (Array.isArray(error.errors)) {
        message = `${error}: ${error.errors.map((x: any) => inspectError(x)).join(',')}`
    } else {
        message = `${error}`;
    }

    if (message.length > 500) {
        return `${message.substring(0, 500)}...`;
    } else {
        return message;
    }
}
