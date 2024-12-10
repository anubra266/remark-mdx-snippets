import path from 'node:path';
import { readSync } from 'to-vfile';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import remarkMdx from 'remark-mdx';
// @ts-ignore
import flatMap from 'unist-util-flatmap';

/**
 * @typedef {import('mdast').RootContent} RootContent
 * @typedef {import('mdast').Parent} Parent
 * @typedef {import('vfile').VFile} VFile
 *
 * @typedef PluginOptions
 * @property {string} [snippetsDir] - Directory to resolve snippet files from
 * @property {string} [fileAttribute] - Custom attribute name for file path (default: 'file')
 * @property {string} [elementName] - Custom element name for snippets (default: 'Snippet')
 * @property {any} [processor] - Custom processor
 */

/**
 * Plugin to process and include external snippet files in MDX
 *
 * @param {PluginOptions} [options={}]
 * @returns {(tree: RootContent, file: VFile) => RootContent}
 */
export function mdxSnippet(options = {}) {
  const {
    snippetsDir = path.resolve(process.cwd(), '_snippets'),
    fileAttribute = 'file',
    elementName = 'Snippet',
    processor: unified,
  } = options;

  return (tree, file) => {
    // @ts-ignore
    return flatMap(tree, (node) => {
      if (node.type !== 'mdxJsxFlowElement' || node.name !== elementName) {
        return [node];
      }

      // @ts-ignore
      const fileAttr = node.attributes.find((attr) => attr.name === fileAttribute);

      if (!fileAttr || typeof fileAttr.value !== 'string') {
        console.warn(
          `${elementName} tag missing required "${fileAttribute}" attribute:`,
          node
        );
        return [node];
      }

      const filePath = path.join(snippetsDir, fileAttr.value);

      let snippetFile;
      try {
        snippetFile = readSync(filePath, 'utf8');
      } catch (error) {
        console.error(
          'Error reading snippet file:',
          `\n\nSnippet at: ${file.path}:${node.position.start.line}:${node.position.start.column}`,
          `\nFile path: ${filePath}`,
          `\nError: ${error instanceof Error ? error.message : String(error)}`
        );
        return [node];
      }

      // Construct a processor for the snippet content that includes this plugin again
      // so nested snippets are also processed.
      const snippetProcessor = (unified ?? remark())
        .use(remarkGfm)
        .use(remarkStringify)
        .use(remarkMdx)
        .use(mdxSnippet, { snippetsDir, fileAttribute, elementName, processor: unified });

      // Parse and transform the snippet content
      const ast = snippetProcessor().parse(snippetFile);
      const result = snippetProcessor().runSync(ast, snippetFile);

      // Return the processed children, which now includes any nested snippet expansions
      return result.children;
    });
  };
}
