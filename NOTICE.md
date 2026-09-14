# Third-party content

## Game data

The files in `data/raw/` and the encoded bundle in `public/data/` are derived
from the npm package [`assistantapps-nomanssky-info`][pkg] (version 6.1.4990),
published by **AssistantApps — Kurt Lourens** as part of the
[Assistant for No Man's Sky][anms] project, which extracts the data from the
No Man's Sky game files.

That package is distributed under the **ISC License**:

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
```

## Item artwork

Item icons in `public/icons/` are mirrored from `cdn.nmsassistant.com`,
operated by the same project, and downscaled to 96px WebP for use as thumbnails
(the originals average ~348 KB and are rendered here at 34-72px). They are
redistributed in this repository under the same ISC terms as the data package.
The underlying artwork is the property of Hello Games.

## Trademarks

*No Man's Sky* is a trademark of **Hello Games Ltd**. Game names, item names,
descriptions and artwork are the property of Hello Games. This is an unofficial
fan reference and is not affiliated with, endorsed by, or sponsored by Hello
Games or AssistantApps.

[pkg]: https://www.npmjs.com/package/assistantapps-nomanssky-info
[anms]: https://nmsassistant.com/
