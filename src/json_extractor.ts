export class JsonExtractor {
    private object: unknown;

    constructor(object: unknown) {
        this.object = object;
    }

    asObject(key: string): JsonExtractor | undefined {
        if (typeof this.object !== 'object') {
            return undefined;
        }

        if (this.object === null) {
            return undefined;
        }

        const object = this.object as Record<string, unknown>;
        if (object[key] === undefined) {
            return undefined;
        }

        return new JsonExtractor(object[key]);
    }

    asArray(): JsonExtractor[] | undefined {
        if (!Array.isArray(this.object)) {
            return [this];
        }

        return this.object.map(x => new JsonExtractor(x));
    }

    asNumber(): number | undefined {
        if (typeof this.object != 'number') {
            return undefined;
        }

        return this.object;
    }

    asString(): string | undefined {
        if (typeof this.object != 'string') {
            return undefined;
        }

        return this.object;
    }

    asBoolean(): boolean | undefined {
        if (typeof this.object != 'boolean') {
            return undefined;
        }

        return this.object;
    }
}
