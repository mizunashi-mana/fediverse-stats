import { Command } from "commander";
import { Fetcher } from "./fetcher.js";
import { loadMeasurement } from "./measurement.js";

async function main(): Promise<void> {
    const {
        options,
        args
    } = await parseArgs();

    console.log("Setup...");
    const fetcher = new Fetcher(options.fetchTimeoutSec);
    const measurement = await loadMeasurement(
        options.resultFile,
        options.queueFile,
        options.ngListFile,
    );

    await measurement.enqueueHost(args, undefined);

    let limit = options.fetchLimit;
    while (limit === undefined || limit > 0) {
        const host = measurement.dequeueHost();
        if (host === undefined) {
            break;
        }

        if (limit !== undefined) {
            limit = limit - 1;
        }

        const queuedCount = measurement.queuedCount();
        console.log(`[${queuedCount.toString().padStart(8, ' ')} rests]: fetch ${host}...`);

        const nodeInfo = await fetcher.fetchNodeinfo(host);
        console.debug(`Fetched the node info of ${host}.`);
        switch (nodeInfo.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                await measurement.registerStats({
                    host,
                    type: 'fail',
                    resource_status: nodeInfo.resourceStatus,
                    detail: nodeInfo.detail,
                });
                continue;
        }

        const peers = await fetcher.fetchPeers(host);
        console.debug(`Fetched peers of ${host}.`);
        switch (peers.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                console.warn(`Failed to fetch peers of ${host}: ${peers.detail}`);
                await measurement.registerStats({
                    host,
                    type: 'ok',
                    node_info: nodeInfo.data,
                });
                continue;
        }

        await measurement.registerStats({
            host,
            type: 'ok',
            node_info: nodeInfo.data,
            peers_count: peers.data.hosts.length,
        });
        console.debug(`Registered stats of ${host}.`);

        const enqueueResult = await measurement.enqueueHost(peers.data.hosts, host);
        if (enqueueResult.includeNg) {
            console.warn(`The peers of ${host} include some NG peers.`);
        }
    }

    console.log('Finish.');
}

async function parseArgs(): Promise<{
    options: {
        queueFile: string;
        resultFile: string;
        ngListFile: string;
        fetchTimeoutSec: number;
        fetchLimit?: number;
    };
    args: string[];
}> {
    const program = new Command();
    program
        .name('fediverse-stats')
        .description('Fetch stats of Fediverse instances.')
        .version('0.1.0');

    program.option('--result-file <PATH>', 'A file path of results.', 'fediverse-stats.txt');
    program.option('--queue-file <PATH>', 'A file path of queue.');
    program.option('--ng-list-file <PATH>', 'A file path of NG filters.', 'ng-list.txt');
    program.option('--fetch-timeout-sec <INT>', 'Timeout to fetch by seconds.', parseInt, 3);
    program.option('--fetch-limit <INT>', 'Limit count to fetch (optional)', parseInt);
    program.argument('<HOST>', 'The start hosts to fetch');

    await program.parseAsync();

    const options = program.opts();
    const args = program.args;

    return {
        options: {
            fetchTimeoutSec: options.fetchTimeoutSec,
            fetchLimit: options.fetchLimit,
            resultFile: options.resultFile,
            queueFile: options.queueFile === undefined ? `${options.resultFile}.queue` : options.queueFile,
            ngListFile: options.ngListFile,
        },
        args,
    };
}

export default await main();
