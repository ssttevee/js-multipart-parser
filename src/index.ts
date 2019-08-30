import { StreamSearch } from '@ssttevee/streamsearch';
import { stringToArray, arrayToString, mergeArrays } from '@ssttevee/u8-utils';

interface ContentDisposition {
    name: string;
    filename?: string;
}

function parseContentDisposition(header: string): ContentDisposition {
    const parts = header.split(';').map((part) => part.trim());
    if (parts.shift() !== 'form-data') {
        throw new Error('malformed content-disposition header: missing "form-data" in `' + JSON.stringify(parts) + '`');
    }

    const out: any = {};
    for (const part of parts) {
        const kv = part.split('=');
        if (kv.length !== 2) {
            throw new Error('malformed content-disposition header: more than one equals sign in key-value set - ' + part + ' in `' + header + '`');
        }

        const [name, value] = kv;
        if (value[0] === '"' && value[value.length - 1] === '"') {
            out[name] = value.slice(1, -1).replace(/\\"/g, '"');
        } else if (value[0] !== '"' && value[value.length - 1] !== '"') {
            out[name] = value;
        } else if (value[0] === '"' && value[value.length - 1] !== '"' || value[0] !== '"' && value[value.length - 1] === '"') {
            throw new Error('malformed content-disposition header: mismatched quotations in `' + header + '`');
        }
    }

    if (!out.name) {
        throw new Error('malformed content-disposition header: missing field name in `' + header + '`');
    }

    return out;
}

export interface Part {
    name: string;
    data: Uint8Array;
    filename?: string;
    contentType?: string;
}

function parsePart(lines: Uint8Array[]): Part {
    const headers = new Headers();
    while (lines.length) {
        const line = arrayToString(lines.shift()!);
        if (!line.length) {
            break;
        }

        const colon = line.indexOf(':');
        if (colon === -1) {
            throw new Error('malformed multipart-form header: missing colon');
        }

        headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }

    const contentDisposition = headers.get('content-disposition');
    if (!contentDisposition) {
        throw new Error('malformed multipart-form header: missing content-disposition');
    }

    return {
        ...parseContentDisposition(contentDisposition),
        contentType: headers.get('content-type') || undefined,
        data: mergeArrays(...lines),
    };
}

const dash = '-'.charCodeAt(0);

const MatchTypeBoundary = Symbol('boundary');
const MatchTypeEnd = Symbol('end');

type MatchType = typeof MatchTypeBoundary | typeof MatchTypeEnd;

class BoundaryMatcher {
    private boundary: Uint8Array;

    public constructor(boundary: string) {
        this.boundary = stringToArray('--' + boundary);
    }

    public match(buf: Uint8Array): MatchType | null {
        if ((this.boundary.length !== buf.length && this.boundary.length !== buf.length - 2) ||
            !this.boundary.every((x: number, i: number) => x === buf[i]) ||
            (this.boundary.length < buf.length && !buf.slice(-2).every((x: number) => x === dash))) {
            return null;
        }

        return this.boundary.length === buf.length ? MatchTypeBoundary : MatchTypeEnd;
    }
}

const CRLF = stringToArray('\r\n');

export async function *iterateMultipart(body: ReadableStream<Uint8Array>, boundary: string): AsyncIterableIterator<Part> {
    const matcher = new BoundaryMatcher(boundary);

    let current: Uint8Array[] | null = null, match: MatchType | null = null;
    for await (const line of new StreamSearch(CRLF, body).arrays()) {
        if ((match = matcher.match(line)) && current) {
            yield parsePart(current);
        }

        switch (match) {
            case MatchTypeBoundary:
                current = [];
                continue;
            case MatchTypeEnd:
                return;
        }

        if (current) {
            current.push(line);
        }
    }

    throw new Error('malformed multipart-form data: unexpected end of stream');
}

export async function parseMultipart(body: ReadableStream<Uint8Array>, boundary: string): Promise<Part[]> {
    const parts: Part[] = [];
    for await (const part of iterateMultipart(body, boundary)) {
        parts.push(part);
    }

    return parts;
}
