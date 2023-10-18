import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import { InstanceStats, NgFilter, QueueLine } from './types.js';

type Queued = {
    [host: string]: {
        checked: boolean;
    };
};

type NgList = NgFilter[];

export class Measurement {
    private resultFilePath: string;
    private queueFilePath: string;
    private queued: Queued;
    private hostsQueue: string[];

    /**
     * TODO: Optimize and introduce auto detection.
     */
    private ngList: NgList;

    constructor(
        resultFilePath: string,
        queued: Queued,
        queueFilePath: string,
        hostsQueue: string[],
        ngList: NgFilter[],
    ) {
        this.resultFilePath = resultFilePath;
        this.queued = queued;
        this.queueFilePath = queueFilePath;
        this.hostsQueue = hostsQueue;
        this.ngList = ngList;
    }

    async registerStats(stats: InstanceStats): Promise<void> {
        this.queued[stats.host] = {
            checked: true,
        };
        await appendLines(this.resultFilePath, [stats]);
    }

    async enqueueHost(hosts: string[], fromHost: string | undefined): Promise<{
        includeNg: boolean;
    }> {
        const result = {
            includeNg: false,
        };

        const queueLines: QueueLine[] = [];
        const queued: { [host: string]: boolean; } = {};
        for (const host of hosts) {
            if (isNgHost(host, this.ngList)) {
                result.includeNg = true;
                continue;
            }

            if (this.queued[host] === undefined && queued[host] === undefined) {
                queueLines.push({
                    host,
                    from_host: fromHost,
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

        return result;
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
    ngListFilePath: string,
): Promise<Measurement> {
    const queued: Queued = {};
    const hostsQueue: string[] = [];
    const ngList: NgList = [];

    let existsResultFile = false;
    try {
        await fsPromises.access(resultFilePath, fs.constants.R_OK | fs.constants.W_OK);
        existsResultFile = true;
    } catch {
        await fsPromises.writeFile(resultFilePath, '');
    }
    if (existsResultFile) {
        await fsPromises.copyFile(resultFilePath, `${resultFilePath}.backup`);
    }
    await loadJsonLines(resultFilePath, async (data: InstanceStats) => {
        queued[data.host] = {
            checked: true,
        };
    });

    let existsNgListFile = false;
    try {
        await fsPromises.access(ngListFilePath, fs.constants.R_OK | fs.constants.W_OK);
        existsNgListFile = true;
    } catch {
        await fsPromises.writeFile(ngListFilePath, '');
    }
    if (existsNgListFile) {
        await fsPromises.copyFile(ngListFilePath, `${ngListFilePath}.backup`);
    }
    await loadJsonLines(ngListFilePath, async (data: NgFilter) => {
        ngList.push(data);
    });

    let existsQueueFile = false;
    try {
        await fsPromises.access(queueFilePath, fs.constants.R_OK | fs.constants.W_OK);
        existsQueueFile = true;
    } catch {
        await fsPromises.writeFile(queueFilePath, '');
    }
    if (existsQueueFile) {
        await uniqueQueueFile(queueFilePath, ngList);
    }
    await loadJsonLines(queueFilePath, async (data: QueueLine) => {
        if (queued[data.host] === undefined) {
            queued[data.host] = {
                checked: false,
            };
            hostsQueue.push(data.host);
        }
    });

    return new Measurement(resultFilePath, queued, queueFilePath, hostsQueue, ngList);
}

async function uniqueQueueFile(filePath: string, ngList: NgList): Promise<void> {
    const backupFilePath = `${filePath}.backup`
    await fsPromises.copyFile(filePath, backupFilePath);

    const queuedHosts: { [host: string]: boolean; } = {};
    await fsPromises.writeFile(filePath, '');

    let buffer: QueueLine[] = [];
    await loadJsonLines(backupFilePath, async (line: QueueLine) => {
        if (!queuedHosts[line.host] && !isNgHost(line.host, ngList)) {
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

function isNgHost(host: string, ngList: NgList): boolean {
    const [domain] = host.split(':', 2);
    for (const ngFilter of ngList) {
        switch (ngFilter.type) {
            case 'subdomain':
                if (domain.endsWith(`.${ngFilter.main_domain}`)) {
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
