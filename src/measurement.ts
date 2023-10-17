import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import { InstanceStats, QueueLine } from './types.js';

type Queued = {
    [host: string]: {
        checked: boolean;
    };
};

export class Measurement {
    private resultFilePath: string;
    private queueFilePath: string;
    private queued: Queued;
    private hostsQueue: string[];

    constructor(
        resultFilePath: string,
        queued: Queued,
        queueFilePath: string,
        hostsQueue: string[],
    ) {
        this.resultFilePath = resultFilePath;
        this.queued = queued;
        this.queueFilePath = queueFilePath;
        this.hostsQueue = hostsQueue;
    }

    async registerStats(stats: InstanceStats): Promise<void> {
        this.queued[stats.host] = {
            checked: true,
        };
        await appendLines(this.resultFilePath, [stats]);
    }

    async enqueueHost(host: string): Promise<void> {
        if (this.queued[host] === undefined) {
            const queueLine: QueueLine = {
                host,
            };
            await appendLines(this.queueFilePath, [queueLine]);
            this.queued[host] = {
                checked: false,
            };
            this.hostsQueue.push(host);
        }
    }

    dequeueHost(): string | undefined {
        while (true) {
            const host = this.hostsQueue.shift();
            if (host === undefined) {
                return undefined;
            }

            if (this.queued[host]?.checked !== true) {
                return host;
            }
        }
    }

    queuedCount(): number {
        return this.hostsQueue.length;
    }
}

export async function loadMeasurement(
    resultFilePath: string,
    queueFilePath: string,
): Promise<Measurement> {
    const queued: Queued = {};
    const hostsQueue: string[] = [];

    try {
        await fsPromises.access(resultFilePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        await fsPromises.writeFile(resultFilePath, '');
    }
    await loadJsonLines(resultFilePath, async (data: InstanceStats) => {
        queued[data.host] = {
            checked: true,
        };
    });

    try {
        await fsPromises.access(queueFilePath, fs.constants.R_OK | fs.constants.W_OK);
        const backupFilePath = `${queueFilePath}.backup`
        await fsPromises.copyFile(queueFilePath, backupFilePath);
    } catch {
        await fsPromises.writeFile(queueFilePath, '');
    }
    await loadJsonLines(queueFilePath, async (data: QueueLine) => {
        if (queued[data.host] === undefined) {
            queued[data.host] = {
                checked: false,
            };
            hostsQueue.push(data.host);
        }
    });

    return new Measurement(resultFilePath, queued, queueFilePath, hostsQueue);
}

async function appendLines<T>(filePath: string, lines: T[]): Promise<void> {
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

            const data: T = JSON.parse(lineBuffer);
            await processor(data);

            lineBuffer = '';
        }
    }
    if (lineBuffer !== '') {
        const data: T = JSON.parse(lineBuffer);
        await processor(data);
    }

    stream.close();
}
