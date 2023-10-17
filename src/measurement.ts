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

    async enqueueHost(hosts: string[]): Promise<void> {
        const queueLines: QueueLine[] = [];
        const queued: { [host: string]: boolean; } = {};
        for (const host of hosts) {
            if (this.queued[host] === undefined && queued[host] === undefined) {
                queueLines.push({
                    host,
                });
            }
        }

        await appendLines(this.queueFilePath, queueLines);
        for (const queueLine of queueLines) {
            this.queued[queueLine.host] = {
                checked: false,
            };
            this.hostsQueue.push(queueLine.host);
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
        await uniqueQueueFile(queueFilePath);
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

async function uniqueQueueFile(filePath: string): Promise<void> {
    const backupFilePath = `${filePath}.backup`
    await fsPromises.copyFile(filePath, backupFilePath);

    const queuedHosts: { [host: string]: boolean; } = {};
    await fsPromises.writeFile(filePath, '');

    let buffer: QueueLine[] = [];
    await loadJsonLines(backupFilePath, async (line: QueueLine) => {
        if (!queuedHosts[line.host]) {
            buffer.push(line);
        }
        queuedHosts[line.host] = true;

        if (buffer.length > 512) {
            await appendLines(filePath, buffer);
            buffer = [];
        }
    });
    await appendLines(filePath, buffer);
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
