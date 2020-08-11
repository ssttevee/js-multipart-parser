# Description

A simple `multipart/form-data` parser for use with `ReadableStream`s.

# Installation

```bash
npm install @ssttevee/multipart-parser
```

# Example

```js
import { parseMultipart } from '@ssttevee/multipart-parser';

...

async function requestHandler(req) {
    const boundary = '----whatever';
    const parts = await parseMultipart(req.body, boundary);
    const fd = new FormData();
    for (const { name, data, filename, contentType } of parts) {
        if (filename) {
            fd.append(name, new Blob([data], { type: contentType }), filename);
        } else {
            fd.append(name, new TextDecoder().decode(data), filename);
        }
    }
}
```