export type FetchResult<T> =
    | {
        type: 'ok';
        data: T;
    }
    | {
        type: 'fail';
        resourceStatus: 'gone' | 'not-supported' | 'unknown';
        detail: string;
    };

export type NodeInfoResourceType =
    | 'http://nodeinfo.diaspora.software/ns/schema/1.0'
    | 'http://nodeinfo.diaspora.software/ns/schema/2.0'
    | 'http://nodeinfo.diaspora.software/ns/schema/2.1'
    ;

export type NodeInfo = {
    resource_type: NodeInfoResourceType;
    resource_url: string;

    node_name?: string;

    protocols?: string[];
    services_inbound?: string[];
    services_outbound?: string[];

    software_name?: string;
    software_version?: string;
    software_repository?: string;

    users_total?: number;
    users_active_month?: number;
    users_active_half_year?: number;
    local_posts_total?: number;
    local_comments_total?: number;

    maintainer_name?: string;
    open_registrations?: boolean;
    email_required_for_signup?: boolean;
    enable_email?: boolean;
    enable_hcaptcha?: boolean;
    enable_recaptcha?: boolean;

    langs?: string[];
    max_note_text_length?: number;
};

export type Peers = {
    hosts: string[];
};

export type InstanceStats =
    | {
        host: string;
        type: 'fail';
        resource_status: 'gone' | 'not-supported' | 'unknown';
        detail: string;
    }
    | {
        host: string;
        type: 'ok';
        node_info: NodeInfo;
        peers_count?: number;
    };

export type QueueLine = {
    host: string;
};
