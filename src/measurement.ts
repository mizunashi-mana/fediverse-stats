import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import { CheckedLine, InstanceStats, NgFilter, QueueLine, ResultOfInstanceStats } from './types.js';

type TargetsQueue = {
    queue: string[];
    mark: {
        [target: string]: {
            checked: boolean;
        };
    };
};

type CheckedEndpoints = {
    count: number;
    mark: {
        [endpoint: string]: {};
    }
};

type ValidTarget = {
    target: string;
    baseUrl: URL;
};

type NgList = NgFilter[];

export class Measurement {
    private resultFilePath: string;
    private queueFilePath: string;
    private checkedFilePath: string;
    private checkedEndpoints: CheckedEndpoints;
    private targetsQueue: TargetsQueue;

    /**
     * TODO: Optimize and introduce auto detection.
     */
    private ngList: NgList;

    constructor(props: {
        resultFilePath: string;
        queueFilePath: string;
        checkedFilePath: string;
        targetsQueue: TargetsQueue;
        checkedEndpoints: CheckedEndpoints;
        ngList: NgList;
    }) {
        this.resultFilePath = props.resultFilePath;
        this.queueFilePath = props.queueFilePath;
        this.checkedFilePath = props.checkedFilePath;
        this.targetsQueue = props.targetsQueue;
        this.checkedEndpoints = props.checkedEndpoints;
        this.ngList = props.ngList;
    }

    async registerStats(props: {
        target: ValidTarget;
        endpoint: URL;
        result: ResultOfInstanceStats;
    }): Promise<void> {
        const stats: InstanceStats = {
            endpoint: props.endpoint.toString(),
            checked_target: props.target.target,
            result: props.result,
        };
        await appendLines(this.resultFilePath, [stats]);

        this.checkedEndpoints.count = this.checkedEndpoints.count + 1;
        this.checkedEndpoints.mark[stats.endpoint] = {};
        await this.markTargetsChecked([props.target]);
    }

    endpointByResourceUrl(url: URL): URL {
        return endpointByResourceUrl(url);
    }

    isEndpointChecked(endpoint: URL): boolean {
        return this.checkedEndpoints.mark[endpoint.toString()] !== undefined;
    }

    async markTargetsChecked(targets: ValidTarget[]): Promise<void> {
        const checkedLines: CheckedLine[] = [];
        const checked: { [target: string]: {}; } = {};
        for (const target of targets) {
            if (this.targetsQueue.mark[target.target]?.checked !== true && checked[target.target] === undefined) {
                checkedLines.push({
                    target: target.target,
                });
            }
        }

        await appendLines(this.checkedFilePath, checkedLines);
        for (const line of checkedLines) {
            this.targetsQueue.mark[line.target] = {
                checked: true,
            };
        }
    }

    async enqueueTargets(targets: string[], fromEndpoint: URL | undefined): Promise<{
        includeNg: boolean;
        includeInvalid: boolean;
    }> {
        const result = {
            includeNg: false,
            includeInvalid: false,
        };

        const queueLines: QueueLine[] = [];
        const queued: { [target: string]: {}; } = {};
        for (const target of targets) {
            const validTarget = validateTarget(target);
            if (validTarget === undefined) {
                result.includeInvalid = true;
                continue;
            }

            if (isNgTarget(validTarget, this.ngList)) {
                result.includeNg = true;
                continue;
            }

            if (this.targetsQueue.mark[target] === undefined && queued[target] === undefined) {
                queueLines.push({
                    target: validTarget.target,
                    from_endpoint: fromEndpoint?.toString(),
                });
            }
        }

        await appendLines(this.queueFilePath, queueLines);
        for (const queueLine of queueLines) {
            this.targetsQueue.mark[queueLine.target] = {
                checked: false,
            };
            this.targetsQueue.queue.push(queueLine.target);
        }

        return result;
    }

    dequeueTarget(): ValidTarget | undefined {
        while (true) {
            const target = this.targetsQueue.queue.shift();
            if (target === undefined) {
                return undefined;
            }

            const validTarget = validateTarget(target);
            if (validTarget === undefined) {
                continue;
            }

            if (this.targetsQueue.mark[target]?.checked === true) {
                continue;
            }

            return validTarget;
        }
    }

    queuedTargetsCount(): number {
        return this.targetsQueue.queue.length;
    }

    checkedEndpointsCount(): number {
        return this.checkedEndpoints.count;
    }
}

export async function loadMeasurement(props: {
    resultFilePath: string;
    queueFilePath: string;
    checkedFilePath: string;
    ngListFilePath: string;
}): Promise<Measurement> {
    const targetsQueue: TargetsQueue = {
        queue: [],
        mark: {},
    };
    const checkedEndpoints: CheckedEndpoints = {
        count: 0,
        mark: {},
    };
    const ngList: NgList = [];

    await processExistsFileOrCreate(props.resultFilePath, async () => {
        await fsPromises.copyFile(props.resultFilePath, `${props.resultFilePath}.backup`);
    });
    await loadJsonLines(props.resultFilePath, async (data: InstanceStats) => {
        checkedEndpoints.mark[data.endpoint] = {};
        checkedEndpoints.count = checkedEndpoints.count + 1;
    });

    await processExistsFileOrCreate(props.ngListFilePath, async () => {
        await fsPromises.copyFile(props.ngListFilePath, `${props.ngListFilePath}.backup`);
    });
    await loadJsonLines(props.ngListFilePath, async (data: NgFilter) => {
        ngList.push(data);
    });

    await processExistsFileOrCreate(props.checkedFilePath, async () => {
        await fsPromises.copyFile(props.checkedFilePath, `${props.checkedFilePath}.backup`);
    });
    await loadJsonLines(props.checkedFilePath, async (data: CheckedLine) => {
        targetsQueue.mark[data.target] = {
            checked: true,
        };
    });

    await processExistsFileOrCreate(props.queueFilePath, async () => {
        await backupAndUnifyQueueFile(props.queueFilePath, ngList);
    });
    await loadJsonLines(props.queueFilePath, async (data: QueueLine) => {
        if (targetsQueue.mark[data.target] === undefined) {
            targetsQueue.mark[data.target] = {
                checked: false,
            };
            targetsQueue.queue.push(data.target);
        }
    });

    return new Measurement({
        resultFilePath: props.resultFilePath,
        checkedFilePath: props.checkedFilePath,
        queueFilePath: props.queueFilePath,
        targetsQueue,
        checkedEndpoints,
        ngList,
    });
}

async function backupAndUnifyQueueFile(filePath: string, ngList: NgList): Promise<void> {
    const backupFilePath = `${filePath}.backup`
    await fsPromises.copyFile(filePath, backupFilePath);

    const queuedTargets: { [target: string]: {}; } = {};
    await fsPromises.writeFile(filePath, '');

    let buffer: QueueLine[] = [];
    await loadJsonLines(backupFilePath, async (line: QueueLine) => {
        if (queuedTargets[line.target] !== undefined) {
            return;
        }

        const validTarget = validateTarget(line.target);
        if (validTarget === undefined) {
            return;
        }

        if (isNgTarget(validTarget, ngList)) {
            return;
        }

        buffer.push(line);
        queuedTargets[validTarget.target] = {};

        if (buffer.length > 512) {
            await appendLines(filePath, buffer);
            buffer = [];
        }
    });
    await appendLines(filePath, buffer);
}

function endpointByResourceUrl(url: URL): URL {
    return new URL('/', url);
}

function validateTarget(target: string): ValidTarget | undefined {
    let url: URL;
    try {
        url = new URL(`https://${target}`);
    } catch {
        return undefined;
    }

    return {
        target,
        baseUrl: endpointByResourceUrl(url),
    };
}

function isNgTarget(target: ValidTarget, ngList: NgList): boolean {
    const hostname = target.baseUrl.hostname;
    for (const ngFilter of ngList) {
        switch (ngFilter.type) {
            case 'subdomain':
                if (hostname.endsWith(`.${ngFilter.main_domain}`)) {
                    return true;
                }
        }
    }
    return false;
}

async function appendLines<T>(filePath: string, lines: T[]): Promise<void> {
    if (lines.length === 0) {
        return;
    }

    const contents = `${lines.map(x => JSON.stringify(x)).join('\n')}\n`;
    await fsPromises.appendFile(filePath, contents);
}

async function loadJsonLines<T>(filePath: string, processor: (lineJson: T) => Promise<void>): Promise<void> {
    const stream = fs.createReadStream(filePath, {
        encoding: 'utf-8',
    });

    let lineBuffer = '';
    for await (const chunkOfStream of stream) {
        let chunk: string = chunkOfStream;
        while (true) {
            const splitIndex = chunk.indexOf('\n');
            if (splitIndex === -1) {
                lineBuffer = `${lineBuffer}${chunk}`;
                break;
            }

            const lineChunk = chunk.substring(0, splitIndex);
            lineBuffer = `${lineBuffer}${lineChunk}`;
            chunk = chunk.substring(splitIndex + 1);

            if (lineBuffer !== '' && !lineBuffer.startsWith('#')) {
                const data: T = JSON.parse(lineBuffer);
                await processor(data);
            }

            lineBuffer = '';
        }
    }
    if (lineBuffer !== '') {
        const data: T = JSON.parse(lineBuffer);
        await processor(data);
    }

    stream.close();
}

async function processExistsFileOrCreate(filePath: string, ifExists: () => Promise<void>): Promise<void> {
    let existsFile = false;
    try {
        await fsPromises.access(filePath, fs.constants.R_OK | fs.constants.W_OK);
        existsFile = true;
    } catch {
        await fsPromises.writeFile(filePath, '');
    }
    if (existsFile) {
        await ifExists();
    }
}
