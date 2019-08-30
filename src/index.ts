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

type Matcher = (buf: Uint8Array) => boolean;

function matcher(a: Uint8Array): Matcher {
    return (b: Uint8Array): boolean => a.length === b.length && a.every((x: number, i: number) => x === b[i]);
}

function boundaryMatcher(boundary: string): [Matcher, Matcher] {
    const buf = stringToArray('--' + boundary + '--');
    return [
        matcher(buf.slice(0, -2)),
        matcher(buf),
    ]
}

const CRLF = stringToArray('\r\n');

export async function parseMultipart(body: ReadableStream<Uint8Array>, boundary: string): Promise<Part[]> {
    const [isBoundary, isEnd] = boundaryMatcher(boundary);
    const parts: Part[] = [];

    let current: Uint8Array[] | null = null;
    for await (const line of new StreamSearch(CRLF, body).arrays()) {
        if (isBoundary(line)) {
            if (current) {
                parts.push(parsePart(current));
            }

            current = [];
        } else if (isEnd(line)) {
            if (current) {
                parts.push(parsePart(current));
            }

            break;
        } else if (current) {
            current.push(line);
        }
    }

    return parts;
}
