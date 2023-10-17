import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import { InstanceStats, QueueLine } from './types.js';

export class Measurement {
    private resultFilePath: string;
    private checked: { [host: string]: boolean; };

    private queueFilePath: string;
    private hostsQueue: string[];

    constructor(
        resultFilePath: string,
        checked: { [host: string]: boolean; },
        queueFilePath: string,
        hostsQueue: string[],
    ) {
        this.resultFilePath = resultFilePath;
        this.checked = checked;
        this.queueFilePath = queueFilePath;
        this.hostsQueue = hostsQueue;
    }

    async registerStats(stats: InstanceStats): Promise<void> {
        this.checked[stats.host] = true;
        await appendLines(this.resultFilePath, [stats]);
    }

    async enqueueHost(host: string): Promise<void> {
        if (!this.checked[host]) {
            const queueLine: QueueLine = {
                host,
            };
            await appendLines(this.queueFilePath, [queueLine]);
            this.hostsQueue.push(host);
        }
    }

    dequeueHost(): string | undefined {
        while (true) {
            const host = this.hostsQueue.shift();
            if (host === undefined) {
                return undefined;
            }

            if (!this.checked[host]) {
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
    const checked: { [host: string]: boolean; } = {};
    const hostsQueue: string[] = [];

    try {
        await fsPromises.access(resultFilePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        await fsPromises.writeFile(resultFilePath, '');
    }
    await loadJsonLines(resultFilePath, async (data: InstanceStats) => {
        checked[data.host] = true;
    });

    try {
        await fsPromises.access(queueFilePath, fs.constants.R_OK | fs.constants.W_OK);
        await uniqueQueueFile(queueFilePath);
    } catch {
        await fsPromises.writeFile(queueFilePath, '');
    }
    await loadJsonLines(queueFilePath, async (data: QueueLine) => {
        if (!checked[data.host]) {
            hostsQueue.push(data.host);
        }
    });

    return new Measurement(resultFilePath, checked, queueFilePath, hostsQueue);
}

async function appendLines<T>(filePath: string, lines: T[]): Promise<void> {
    const contents = `${lines.map(x => JSON.stringify(x)).join('\n')}\n`;
    await fsPromises.appendFile(filePath, contents);
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
        console.log(`buffer: ${lineBuffer}`);
        const data: T = JSON.parse(lineBuffer);
        await processor(data);
    }

    stream.close();
}
