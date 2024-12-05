<div align="center">

  <h1>
    <br/>
    🏇
    <br />
    remark-mdx-snippets
    <br />
    <br />
  </h1>
  <sup>
    <br />
    <br />
    <a href="https://www.npmjs.com/package/remark-mdx-snippets?style=for-the-badge">
       <img src="https://img.shields.io/npm/v/remark-mdx-snippets.svg?style=for-the-badge" alt="npm package" />
    </a>
    <a href="https://www.npmjs.com/package/remark-mdx-snippets?style=for-the-badge">
      <img src="https://img.shields.io/npm/dw/remark-mdx-snippets.svg?style=for-the-badge" alt="npm  downloads" />
    </a>
<a>
    <img alt="NPM" src="https://img.shields.io/npm/l/remark-mdx-snippets?style=for-the-badge">
</a>

<a><img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/anubra266/remark-mdx-snippets?logo=github&style=for-the-badge">

</a>
    <br />
   Snippets for your markdown
    
  </sup>
  <br />
  <br />
  <br />
  <br />
  <pre>npm i <a href="https://www.npmjs.com/package/remark-mdx-snippets">remark-mdx-snippets</a></pre>
  <br />
  <br />
  <br />
  <br />
  <br />
</div>

## Install

```bash
npm i --save remark-mdx-snippets
#or
yarn add remark-mdx-snippets
#or
pnpm add remark-mdx-snippets
```

## About

Reusable and nestable snippets inspired by [Mintlify](https://mintlify.com/docs/reusable-snippets)

## Usage

### Remark

```ts
import remarkMDXSnippets from 'remark-mdx-snippets';
import {remark} from 'remark';

remark().use(remarkMDXSnippets).process(`<Snippet file="snippet" />`);
```

### Markdown

1. Have a folder that stores snippets. By default the plugin checks the `_snippets` folder in your root directory.
2. In your markdown (`.mdx`)

```jsx
## Some title

Any normal markdown content

<Snippet file="a-snippet-file.mdx" />
```

The plugin then checks your `_snippets` for a `<file>.mdx` In this example it finds `a-snippet-file.mdx`. THe content of the file is then resolved like it was written in the current markdown.

**NB:**

1.  You can use snippets within snippets. (nesting)
2.  You can have folders within the snippets directory, you don't have to put all snippets flat in that folder.

## Configure

```ts
import remarkMDXSnippets from 'remark-mdx-snippets';
import {remark} from 'remark';

remark()
	.use(remarkMDXSnippets, {
		// Use a different directory to resolve snippets
		snippetsDir: path.resolve(process.cwd(), 'includes'),
		// Change attribute or element name
		fileAttribute: 'path',
		elementName: 'CodeSnippet',
	})
	.process(`<CodeSnippet path="snippet/path" />`);
```

## Sponsors ✨

Thanks goes to these wonderful people

<p align="center">
  <a href="https://patreon.com/anubra266?utm_medium=clipboard_copy&utm_source=copyLink&utm_campaign=creatorshare_creator&utm_content=join_link">
    <img src='https://cdn.jsdelivr.net/gh/anubra266/static@main/sponsors.svg'/>
  </a>
</p>
