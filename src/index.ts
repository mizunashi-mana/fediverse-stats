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
    const measurement = await loadMeasurement({
        resultFilePath: options.resultFile,
        queueFilePath: options.queueFile,
        checkedFilePath: options.checkedFile,
        ngListFilePath: options.ngListFile,
    });

    await measurement.enqueueTargets(args, undefined);

    let limit = options.fetchLimit;
    while (limit === undefined || limit > 0) {
        const target = measurement.dequeueTarget();
        if (target === undefined) {
            break;
        }

        if (limit !== undefined) {
            limit = limit - 1;
        }

        const queuedTargetsCount = measurement.queuedTargetsCount().toString().padStart(6, ' ');
        const checkedEndpointsCount = measurement.checkedEndpointsCount().toString().padStart(6, ' ');
        console.log(`[${queuedTargetsCount} rests, ${checkedEndpointsCount} checked]: fetch ${target.baseUrl}...`);

        const nodeInfo = await fetcher.fetchNodeinfo(target.baseUrl);
        console.debug(`Fetched the node info of ${target.baseUrl}.`);
        switch (nodeInfo.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                // Use the base URL as an endpoint.
                const endpoint = target.baseUrl;
                if (measurement.isEndpointChecked(endpoint)) {
                    await measurement.markTargetsChecked([target]);

                    continue;
                }

                await measurement.registerStats({
                    target,
                    endpoint,
                    result: {
                        type: 'fail',
                        resource_status: nodeInfo.resourceStatus,
                        detail: nodeInfo.detail,
                    },
                });
                continue;
        }

        const endpoint = measurement.endpointByResourceUrl(new URL(nodeInfo.data.resource_url));
        if (measurement.isEndpointChecked(endpoint)) {
            await measurement.markTargetsChecked([target]);

            console.warn(`${endpoint} is already fetched. The target may be wrong: ${target.baseUrl}`);
            continue;
        }

        const peers = await fetcher.fetchPeers(endpoint);
        console.debug(`Fetched peers of ${endpoint}.`);
        switch (peers.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                console.warn(`Failed to fetch peers of ${endpoint}: ${peers.detail}`);
                await measurement.registerStats({
                    target,
                    endpoint,
                    result: {
                        type: 'ok',
                        node_info: nodeInfo.data,
                    },
                });
                continue;
        }

        await measurement.registerStats({
            target,
            endpoint,
            result: {
                type: 'ok',
                node_info: nodeInfo.data,
                peers_count: peers.data.hosts.length,
            },
        });
        console.debug(`Registered stats of ${endpoint}.`);

        const enqueueResult = await measurement.enqueueTargets(peers.data.hosts, endpoint);
        if (enqueueResult.includeNg) {
            console.warn(`The peers of ${endpoint} include some NG peers.`);
        }
        if (enqueueResult.includeInvalid) {
            console.warn(`The peers of ${endpoint} include some invalid peers.`);
        }
    }

    console.log('Finish.');
}

async function parseArgs(): Promise<{
    options: {
        queueFile: string;
        checkedFile: string;
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

    program.option('--result-file <path>', 'A file path of results.', 'fediverse-stats.txt');
    program.option('--queue-file <path>', 'A file path of queue. (default: \'<RESULT_FILE>.queue\')');
    program.option('--checked-file <path>', 'A file path of checked. (default: \'<RESULT_FILE>.checked\')');
    program.option('--ng-list-file <path>', 'A file path of NG filters.', 'ng-list.txt');
    program.option('--fetch-timeout-sec <int>', 'Timeout to fetch by seconds.', (x) => parseInt(x), 3);
    program.option('--fetch-limit <int>', 'Limit count to fetch (optional)', (x) => parseInt(x));
    program.argument('<host>', 'The start hosts to fetch');

    await program.parseAsync();

    const options = program.opts();
    const args = program.args;

    return {
        options: {
            fetchTimeoutSec: options.fetchTimeoutSec,
            fetchLimit: options.fetchLimit,
            resultFile: options.resultFile,
            queueFile: options.queueFile ?? `${options.resultFile}.queue`,
            checkedFile: options.checkedFile ?? `${options.resultFile}.checked`,
            ngListFile: options.ngListFile,
        },
        args,
    };
}

export default await main();
