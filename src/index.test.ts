import test from 'tape-promise/tape';
import { arrayToString, stringToArray } from '@ssttevee/u8-utils';
import { Part, parseMultipart } from './index';
import { ReadableStream, ReadableByteStreamController } from 'web-streams-polyfill/ponyfill/es2018';

function multipartPayload(parts: Part<string>[], boundary: string): string {
    boundary = '\r\n--' + boundary;
    return boundary + '\r\n' + parts.map((part) => {
        let contentDisposition = `Content-Disposition: form-data; name="${part.name}"`;
        if (part.filename) {
            contentDisposition += `; filename="${part.filename}"`;
        }

        let contentType = '';
        if (part.contentType) {
            contentType = `\r\nContent-Type: ${part.contentType}`;
        }

        return contentDisposition + contentType + '\r\n\r\n' + part.data;
    }).join(boundary + '\r\n') + boundary + '--';
}

const expectedParts = [
    { name: 'a', data: 'form value a' },
    { name: 'b', data: 'file value b', filename: 'b.txt' },
    { name: 'c', data: 'file value c\r\nhas\r\nsome new \r\n lines', filename: 'c.txt', contentType: 'text/plain' },
];

const boundary = 'some random boundary';

const testPayload = multipartPayload(expectedParts, boundary);

console.log(testPayload);

function stream(payload: string, size: number): ReadableStream<Uint8Array> {
    let pos = 0;
    return new ReadableStream({
        type: 'bytes',
        pull: (controller: ReadableByteStreamController) => {
            let end = pos + size;
            if (end > payload.length) {
                end = payload.length;
            }

            controller.enqueue(stringToArray(payload.slice(pos, end)));

            if (end === payload.length) {
                controller.close();
            }

            pos = end;
        }
    });
}

function normalizeData(data: string | Uint8Array): string {
    return typeof data === 'string' ? data : arrayToString(data);
}

function equalParts(t: test.Test, actual: Part<string | Uint8Array>, expected: Part<string | Uint8Array>): void {
    t.equals(actual.name, expected.name);
    t.equals(actual.filename, expected.filename);
    t.equals(actual.contentType, expected.contentType);
    t.equals(normalizeData(actual.data), normalizeData(expected.data));
}

test('parse multipart', async function (t) {
    const parts = await parseMultipart(stream(testPayload, 3) as any, boundary);
    t.equals(parts.length, expectedParts.length);
    for (const [i, part] of parts.entries()) {
        equalParts(t, part, expectedParts[i]);
    }

    t.end();
});