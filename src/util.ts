export function isNotUndefined<T>(value: T | undefined): value is T {
    if (value === undefined) {
        return false;
    }

    return true;
}


