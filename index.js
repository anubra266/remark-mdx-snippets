import path from 'node:path';
import {readSync} from 'to-vfile';
import {remark} from 'remark';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import remarkMdx from 'remark-mdx';

/**
 * @typedef {import('mdast').RootContent} RootContent
 * @typedef {import('mdast').Parent} Parent
 * @typedef {import('vfile').VFile} VFile
 *
 * @typedef PluginOptions
 * @property {string} [snippetsDir] - Directory to resolve snippet files from
 * @property {string} [fileAttribute] - Custom attribute name for file path (default: 'file')
 * @property {string} [elementName] - Custom element name for snippets (default: 'Snippet')
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
	} = options;

	return (tree, file) => {
		return flatMap(tree, (node) => {
			// Only process specified Snippet MDX elements
			if (node.type !== 'mdxJsxFlowElement' || node.name !== elementName) {
				return [node];
			}

			// Find file attribute
			const fileAttr = node.attributes.find(
				/** @param {any} attr */
				(attr) => attr.name === fileAttribute
			);

			// Validate file attribute
			if (!fileAttr || typeof fileAttr.value !== 'string') {
				console.warn(
					`${elementName} tag missing required "${fileAttribute}" attribute:`,
					node
				);
				return [node];
			}

			const filePath = path.join(snippetsDir, fileAttr.value);

			let snippetContent = '';
			try {
				snippetContent = readSync(filePath, 'utf8').value.toString();
			} catch (/** @type {unknown} */ error) {
				console.error(
					'Error reading snippet file:',
					`\n\nSnippet at: ${file.path}:${node.position.start.line}:${node.position.start.column}`,
					`\nFile path: ${filePath}`,
					`\nError: ${error instanceof Error ? error.message : String(error)}`
				);
				return [node];
			}

			const processor = remark()
				.use(remarkGfm)
				// @ts-ignore
				.use(remarkStringify)
				// @ts-ignore
				.use(remarkMdx)
				// @ts-ignore
				.use(mdxSnippet, options);

			const ast = processor.parse(snippetContent);
			return processor.runSync(ast, snippetContent).children;
		});
	};
}

/**
 * Recursively transform nodes in an AST
 *
 * @param {RootContent} ast
 * @param {function(any, number, Parent|null): RootContent[]} fn
 * @returns {RootContent}
 */
function flatMap(ast, fn) {
	return transform(ast, 0, null)[0];

	/**
	 * Internal recursive transformation function
	 *
	 * @param {any} node
	 * @param {number} index
	 * @param {Parent|null} parent
	 * @returns {RootContent[]}
	 */
	function transform(node, index, parent) {
		// Process children if they exist
		if (node.children) {
			const out = [];
			for (let i = 0, n = node.children.length; i < n; i++) {
				const xs = transform(node.children[i], i, node);
				if (xs) {
					for (let j = 0, m = xs.length; j < m; j++) {
						out.push(xs[j]);
					}
				}
			}
			node.children = out;
		}

		return fn(node, index, parent);
	}
}
