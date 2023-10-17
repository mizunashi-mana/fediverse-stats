import Axios, { AxiosResponse } from 'axios';
import { URL } from 'node:url';
import { FetchResult, NodeInfo, NodeInfoResourceType, Peers } from './types.js';
import { JsonExtractor } from './json_extractor.js';
import { isNotUndefined } from './util.js';

export class Fetcher {
    private timeoutSec: number;

    constructor(timeoutSec: number) {
        this.timeoutSec = timeoutSec;
    }

    async fetchNodeinfo(host: string): Promise<FetchResult<NodeInfo>> {
        const wellknownResponseUrl = new URL('/.well-known/nodeinfo', `https://${host}`);
        let wellknownResponse: AxiosResponse<unknown, any>;
        try {
            wellknownResponse = await this.requestWithHandling(
                wellknownResponseUrl,
                {
                    'Accept': 'application/json',
                },
            );
        } catch (e) {
            return {
                type: 'fail',
                resourceStatus: 'unknown',
                detail: `Failed to fetch ${wellknownResponseUrl}: ${e}`,
            };
        }
        switch (wellknownResponse.status) {
            case 200:
                // continue
                break;
            case 410:
                return {
                    type: 'fail',
                    resourceStatus: 'gone',
                    detail: `Failed to fetch ${wellknownResponseUrl}: the resource is gone`,
                };
            default:
                return {
                    type: 'fail',
                    resourceStatus: 'unknown',
                    detail: `
Failed to fetch ${wellknownResponseUrl}: invalid status=${wellknownResponse.status}
${JSON.stringify(wellknownResponse.data)}
                    `,
                };
        }

        const wellknownResourceData = new JsonExtractor(wellknownResponse.data);
        const links = wellknownResourceData.asObject('links')?.asArray();
        if (links === undefined) {
            return {
                type: 'fail',
                resourceStatus: 'not-supported',
                detail: `Failed to fetch ${wellknownResponseUrl}: invalid schema.`,
            };
        }

        for (const link of links) {
            const hrefStr = link.asObject('href')?.asString();
            if (hrefStr === undefined) {
                continue;
            }

            let href: URL;
            try {
                href = new URL(hrefStr);
            } catch (e) {
                console.debug(`Failed to parse ${wellknownResponseUrl}: ${e}`);
                continue;
            }

            const rel = link.asObject('rel')?.asString();
            switch (rel) {
                case 'http://nodeinfo.diaspora.software/ns/schema/2.0':
                    return await this.fetchRawNodeinfo(href, rel);
                case 'http://nodeinfo.diaspora.software/ns/schema/2.1':
                    return await this.fetchRawNodeinfo(href, rel);
                default:
                    console.debug(`Unsupported ${rel} on ${wellknownResponseUrl}.`);
                    continue;
            }
        }
        return {
            type: 'fail',
            resourceStatus: 'not-supported',
            detail: `Supported resources are not available on ${wellknownResponseUrl}.`,
        };
    }

    async fetchPeers(host: string): Promise<FetchResult<Peers>> {
        const mastodonPeersUrl = new URL('/api/v1/instance/peers', `https://${host}`);
        let mastodonPeersResponse: AxiosResponse<unknown, any>;
        try {
            mastodonPeersResponse = await this.requestWithHandling(
                mastodonPeersUrl,
                {
                    'Accept': 'application/json',
                },
            );
        } catch (e) {
            return {
                type: 'fail',
                resourceStatus: 'unknown',
                detail: `Failed to fetch ${mastodonPeersUrl}: ${e}`,
            };
        }
        switch (mastodonPeersResponse.status) {
            case 200:
                // continue
                break;
            case 410:
                return {
                    type: 'fail',
                    resourceStatus: 'gone',
                    detail: `Failed to fetch ${mastodonPeersUrl}: the resource is gone`,
                };
            default:
                return {
                    type: 'fail',
                    resourceStatus: 'unknown',
                    detail: `
Failed to fetch ${mastodonPeersUrl}: invalid status=${mastodonPeersResponse.status}
${JSON.stringify(mastodonPeersResponse.data)}
                    `,
                };
        }
        console.debug('Fetched peers.');
        const mastodonPeersData = new JsonExtractor(mastodonPeersResponse.data).asArray()?.map(x => x.asString()).filter(isNotUndefined);
        if (mastodonPeersData !== undefined) {
            return {
                type: 'ok',
                data: {
                    hosts: mastodonPeersData,
                },
            };
        }

        return {
            type: 'fail',
            resourceStatus: 'not-supported',
            detail: 'Mastodon API is not available.',
        };
    }

    private async fetchRawNodeinfo(url: URL, type: NodeInfoResourceType): Promise<FetchResult<NodeInfo>> {
        let response: AxiosResponse<unknown, any>;
        try {
            response = await this.requestWithHandling(
                url,
                {
                    'Accept': 'application/json',
                },
            );
        } catch (e) {
            return {
                type: 'fail',
                resourceStatus: 'unknown',
                detail: `Failed to fetch ${url}: ${e}`,
            };
        }
        switch (response.status) {
            case 200:
                // continue
                break;
            case 410:
                return {
                    type: 'fail',
                    resourceStatus: 'gone',
                    detail: `Failed to fetch ${url}: the resource is gone`,
                };
            default:
                return {
                    type: 'fail',
                    resourceStatus: 'unknown',
                    detail: `
Failed to fetch ${url}: invalid status=${response.status}
${JSON.stringify(response.data)}
                    `,
                };
        }

        const data = new JsonExtractor(response.data);

        return {
            type: 'ok',
            data: {
                resource_type: type,
                resource_url: url.toString(),

                node_name: data.asObject('metadata')?.asObject('nodeName')?.asString(),

                protocols: data.asObject('protocols')?.asArray()?.map(x => x.asString()).filter(isNotUndefined),
                services_inbound: data.asObject('services')?.asObject('inbound')?.asArray()?.map(x => x.asString()).filter(isNotUndefined),
                services_outbound: data.asObject('services')?.asObject('outbound')?.asArray()?.map(x => x.asString()).filter(isNotUndefined),

                software_name: data.asObject('software')?.asObject('name')?.asString(),
                software_version: data.asObject('software')?.asObject('version')?.asString(),
                software_repository: data.asObject('software')?.asObject('repository')?.asString(),

                users_total: data.asObject('usage')?.asObject('users')?.asObject('total')?.asNumber(),
                users_active_month: data.asObject('usage')?.asObject('users')?.asObject('activeMonth')?.asNumber(),
                users_active_half_year: data.asObject('usage')?.asObject('users')?.asObject('activeHalfyear')?.asNumber(),
                local_posts_total: data.asObject('usage')?.asObject('localPosts')?.asNumber(),
                local_comments_total: data.asObject('usage')?.asObject('localComments')?.asNumber(),

                maintainer_name: data.asObject('metadata')?.asObject('maintainer')?.asObject('name')?.asString(),
                open_registrations: data.asObject('openRegistrations')?.asBoolean(),
                email_required_for_signup: data.asObject('metadata')?.asObject('emailRequiredForSignup')?.asBoolean(),
                enable_email: data.asObject('metadata')?.asObject('enableEmail')?.asBoolean(),
                enable_hcaptcha: data.asObject('metadata')?.asObject('enableHcaptcha')?.asBoolean(),
                enable_recaptcha: data.asObject('metadata')?.asObject('enableRecaptcha')?.asBoolean(),

                langs: data.asObject('metadata')?.asObject('langs')?.asArray()?.map(x => x.asString()).filter(isNotUndefined),
                max_note_text_length: data.asObject('metadata')?.asObject('maxNoteTextLength')?.asNumber(),
            },
        };
    }

    private async requestWithHandling<T>(url: URL, headers: { [key: string]: string; }): Promise<AxiosResponse<T, any>> {
        return await Axios.request({
            method: 'get',
            url: url.toString(),
            headers,
            timeout: this.timeoutSec * 1000,
        });
    }
}
