import { StreamSearch } from '@ssttevee/streamsearch';
import { stringToArray, arrayToString, mergeArrays } from '@ssttevee/u8-utils';

const dash = '--';
const CRLF = '\r\n';

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

function splitHeaderAndBody(bodyPart: string): [string[], Uint8Array] {
    const lines = bodyPart.split(CRLF);
    const boundary = lines.indexOf('');
    return [ lines.slice(0, boundary), stringToArray(lines.slice(boundary + 1).join(CRLF)) ];
}

export interface Part {
    name: string;
    data: Uint8Array;
    filename?: string;
    contentType?: string;
}

function parsePart(bodyPart: string): Part {
    const [ lines, data ] = splitHeaderAndBody(bodyPart);

    const headers = new Headers();
    while (lines.length) {
        const line = lines.shift()!;
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
        data,
    };
}

export async function *iterateMultipart(body: ReadableStream<Uint8Array>, boundary: string): AsyncIterableIterator<Part> {
    const it = new StreamSearch(stringToArray(dash + boundary), body).strings();

    // discard prologue
    if ((await it.next()).done) {
        return;
    }

    let bodyParts: string[] = [];
    for await (const bodyPart of it) {
        if (!bodyParts.length && bodyPart.slice(0, 2) === dash) {
            // end of multipart payload, beginning of epilogue
            return;
        }

        bodyParts.push(bodyPart);

        // the next boundary only counts when prefaced with a CRLF,
        // it is otherwise part of the current body part
        if (bodyPart.slice(-2) === CRLF) {
            yield parsePart(bodyParts.join(dash + boundary).slice(2, -2));
            bodyParts = [];
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
