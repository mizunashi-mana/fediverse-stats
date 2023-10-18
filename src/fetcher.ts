import Axios, { AxiosResponse } from 'axios';
import { URL } from 'node:url';
import { FetchResult, NodeInfo, NodeInfoResourceType, Peers } from './types.js';
import { JsonExtractor } from './json_extractor.js';
import { inspectError, isNotUndefined } from './util.js';

export class Fetcher {
    private timeoutSec: number;

    constructor(timeoutSec: number) {
        this.timeoutSec = timeoutSec;
    }

    async fetchNodeinfo(host: string): Promise<FetchResult<NodeInfo>> {
        const wellknownResourceUrl = new URL('/.well-known/nodeinfo', `https://${host}`);
        const wellknownResourceResponse = await this.fetchResource(
            wellknownResourceUrl,
            {
                'Accept': 'application/json',
            },
        );
        switch (wellknownResourceResponse.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                return wellknownResourceResponse;
        }

        const links = wellknownResourceResponse.data.asObject('links')?.asArray();
        if (links === undefined) {
            return {
                type: 'fail',
                resourceStatus: 'not-supported',
                detail: `Failed to fetch ${wellknownResourceUrl}: invalid schema.`,
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
                console.debug(`Failed to parse ${wellknownResourceUrl}: ${e}`);
                continue;
            }

            const rel = link.asObject('rel')?.asString();
            switch (rel) {
                case 'http://nodeinfo.diaspora.software/ns/schema/1.0':
                case 'http://nodeinfo.diaspora.software/ns/schema/2.0':
                case 'http://nodeinfo.diaspora.software/ns/schema/2.1':
                    return await this.fetchRawNodeinfo(href, rel);
                default:
                    console.debug(`Unsupported ${rel} on ${wellknownResourceUrl}.`);
                    continue;
            }
        }
        return {
            type: 'fail',
            resourceStatus: 'not-supported',
            detail: `Supported resources are not available on ${wellknownResourceUrl}.`,
        };
    }

    async fetchPeers(baseUrl: URL): Promise<FetchResult<Peers>> {
        const mastodonPeersUrl = new URL('/api/v1/instance/peers', baseUrl);
        const mastodonPeersResponse = await this.fetchResource(
            mastodonPeersUrl,
            {
                'Accept': 'application/json',
            },
        );
        switch (mastodonPeersResponse.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                return mastodonPeersResponse;
        }

        const mastodonPeersData = mastodonPeersResponse.data.asArray()?.map(x => x.asString()).filter(isNotUndefined);
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
        const response = await this.fetchResource(
            url,
            {
                'Accept': 'application/json',
            },
        );
        switch (response.type) {
            case 'ok':
                // continue
                break;
            case 'fail':
                return response;
        }

        const data = response.data;
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

    private async fetchResource(url: URL, headers: { [key: string]: string; }): Promise<FetchResult<JsonExtractor>> {
        let response: AxiosResponse<unknown, any>;
        try {
            response = await Axios.request({
                method: 'get',
                url: url.toString(),
                headers,
                timeout: this.timeoutSec * 1000,
            });
        } catch (error: any) {
            if (typeof error !== 'object' || error === null) {
                return {
                    type: 'fail',
                    resourceStatus: 'unknown',
                    detail: `Failed to fetch ${url}: ${inspectError(error)}`,
                };
            }

            if (error.response) {
                switch (error.response.status) {
                    case 410:
                        return {
                            type: 'fail',
                            resourceStatus: 'gone',
                            detail: `Failed to fetch ${url}: the resource is gone.`,
                        };
                    case 400:
                    case 404:
                        return {
                            type: 'fail',
                            resourceStatus: 'not-supported',
                            detail: `Failed to fetch ${url}: the resource is not available.`,
                        };
                    default:
                        let detail = JSON.stringify(error.response.data);
                        if (detail.length > 100) {
                            detail = `${detail.substring(0, 100)}...`;
                        }
                        return {
                            type: 'fail',
                            resourceStatus: 'unknown',
                            detail: `Failed to fetch ${url}: invalid status=${error.response.status}, detail=${detail}`,
                        };
                }
            }

            return {
                type: 'fail',
                resourceStatus: 'unknown',
                detail: `Failed to fetch ${url}: ${inspectError(error)}`,
            };
        }

        switch (response.headers['content-type']) {
            case 'text/html':
                return {
                    type: 'fail',
                    resourceStatus: 'not-supported',
                    detail: `JSON resources are not available on ${url}.`,
                };
        }

        return {
            type: 'ok',
            data: new JsonExtractor(response.data),
        };
    }
}
